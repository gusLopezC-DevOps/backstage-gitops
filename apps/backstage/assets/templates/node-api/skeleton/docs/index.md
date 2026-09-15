# ${{ values.repoName }}

API JSON en Node.js desplegada por Argo CD.

- Imagen: `docker.io/guslopezc/${{ values.repoName }}`
- Namespace / AppProject / Application: `${{ values.repoName }}`
- Ingress: `https://${{ values.repoName }}.local`

## Endpoints

```bash
curl https://${{ values.repoName }}.local/health
curl https://${{ values.repoName }}.local/api/${{ values.repoName }}
```

Documentacion generada con TechDocs a partir de este repositorio.