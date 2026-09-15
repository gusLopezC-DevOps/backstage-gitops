# ${{ values.repoName }}

Job / CronJob en Go desplegado por Argo CD (sync manual).

- Imagen: `docker.io/guslopezc/${{ values.repoName }}`
- Namespace / AppProject / Application: `${{ values.repoName }}`
- Cron: `${{ values.schedule }}`

Documentacion generada con TechDocs a partir de este repositorio.