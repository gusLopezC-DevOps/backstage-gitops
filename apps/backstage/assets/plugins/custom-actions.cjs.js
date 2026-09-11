'use strict';

const { createBackendModule } = require('@backstage/backend-plugin-api');
const { scaffolderActionsExtensionPoint } = require('@backstage/plugin-scaffolder-node');
const { createTemplateAction, cloneRepo, commitAndPushRepo, parseRepoUrl } = require('@backstage/plugin-scaffolder-node');
const { ScmIntegrations, DefaultGithubCredentialsProvider } = require('@backstage/integration');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

module.exports = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'custom-gitops-push',
  register({ registerInit }) {
    registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: require('@backstage/backend-plugin-api').coreServices.rootConfig,
      },
      async init({ scaffolder, config }) {
        const integrations = ScmIntegrations.fromConfig(config);
        const githubCredentialsProvider = DefaultGithubCredentialsProvider.fromIntegrations(integrations);

        scaffolder.addActions(
          createTemplateAction({
            id: 'gitops:push-to-repo',
            description: 'Clones an existing repo, copies files from workspace to a subpath, commits, and pushes',
            schema: {
              input: {
                type: 'object',
                required: ['repoUrl', 'subPath'],
                properties: {
                  repoUrl: {
                    title: 'Repository Location',
                    type: 'string',
                    description: "Accepts format github.com?owner=owner&repo=repo",
                  },
                  branch: {
                    title: 'Branch',
                    type: 'string',
                    default: 'main',
                  },
                  gitCommitMessage: {
                    title: 'Commit Message',
                    type: 'string',
                  },
                  subPath: {
                    title: 'Subdirectory Path',
                    type: 'string',
                    description: "Path within the repo to place files (e.g. apps/workloads/my-app)",
                  },
                  appName: {
                    title: 'Application Name',
                    type: 'string',
                    description: 'Value to substitute for ${{ appName }} in template files',
                  },
                  image: {
                    title: 'Container Image',
                    type: 'string',
                    description: 'Value to substitute for ${{ image }} in template files',
                  },
                  hostname: {
                    title: 'Hostname',
                    type: 'string',
                    description: 'Value to substitute for ${{ hostname }} in template files',
                  },
                  port: {
                    title: 'Container Port',
                    type: 'number',
                    description: 'Value to substitute for ${{ port }} in template files',
                  },
                },
              },
              output: {
                type: 'object',
                properties: {
                  commitHash: { title: 'Commit Hash', type: 'string' },
                },
              },
            },
            async handler(ctx) {
              const { repoUrl, branch = 'main', gitCommitMessage, subPath } = ctx.input;
              const { owner, repo, host } = parseRepoUrl(repoUrl, integrations);
              const { token } = await githubCredentialsProvider.getCredentials({
                url: `https://${host}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
              });
              if (!token) throw new Error(`No GitHub token available for ${host}/${owner}/${repo}`);

              const auth = { username: 'x-access-token', password: token };
              const authorInfo = { name: 'Backstage Scaffolder', email: 'scaffolder@backstage.io' };
              const remoteUrl = `https://github.com/${owner}/${repo}.git`;
              const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitops-push-'));

              ctx.logger.info(`Cloning ${remoteUrl} to ${tempDir}`);
              try {
                await cloneRepo({ url: remoteUrl, dir: tempDir, auth, logger: ctx.logger, ref: branch, depth: 1 });
              } catch (ex) {
                ctx.logger.error(`Clone failed: ${ex.message}`);
                throw ex;
              }

              const targetDir = path.join(tempDir, subPath);
              await fs.ensureDir(targetDir);

              ctx.logger.info(`Copying files from ${ctx.workspacePath} to ${targetDir}`);
              await fs.copy(ctx.workspacePath, targetDir, {
                filter: (src) => {
                  const base = path.basename(src);
                  return base !== '.git' && base !== 'node_modules';
                },
              });

              ctx.logger.info(`Substituting template variables in ${targetDir}`);
              const substitutions = {
                appName: ctx.input.appName,
                image: ctx.input.image,
                hostname: ctx.input.hostname,
                port: ctx.input.port,
              };
              function walkDir(dir) {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                  const fullPath = path.join(dir, entry.name);
                  if (entry.isDirectory()) {
                    walkDir(fullPath);
                  } else if (entry.isFile() && /\.(yaml|yml|json)$/i.test(entry.name)) {
                    let content = fs.readFileSync(fullPath, 'utf8');
                    let modified = false;
                    for (const [key, value] of Object.entries(substitutions)) {
                      if (value !== undefined) {
                        const regex = new RegExp(`\\$\\{\\{\\s*${key}\\s*(\\|\\s*default\\([^)]+\\))?\\s*}}`, 'g');
                        const newContent = content.replace(regex, String(value));
                        if (newContent !== content) {
                          content = newContent;
                          modified = true;
                        }
                      }
                    }
                    if (modified) {
                      ctx.logger.info(`  Substituted in ${entry.name}`);
                      fs.writeFileSync(fullPath, content, 'utf8');
                    }
                  }
                }
              }
              walkDir(targetDir);

              ctx.logger.info(`Updating root kustomization.yaml to include ${subPath}`);
              const rootKustPath = path.join(tempDir, 'kustomization.yaml');
              const rootKustContent = fs.readFileSync(rootKustPath, 'utf8');
              const rootKust = yaml.load(rootKustContent);
              if (!rootKust.resources.includes(subPath)) {
                rootKust.resources.push(subPath);
              }
              fs.writeFileSync(rootKustPath, yaml.dump(rootKust));

              const result = await commitAndPushRepo({
                dir: tempDir, auth, logger: ctx.logger,
                commitMessage: gitCommitMessage || `Add files to ${subPath}`,
                gitAuthorInfo: authorInfo, branch,
              });

              await fs.remove(tempDir).catch(() => {});
              ctx.output('commitHash', result.commitHash);
            },
          })
        );
      },
    });
  },
});
