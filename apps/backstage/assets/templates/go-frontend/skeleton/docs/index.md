# ${{ values.repoName }}

Frontend en Go desplegado por Argo CD.

- Imagen: `docker.io/guslopezc/${{ values.repoName }}`
- Namespace / AppProject / Application: `${{ values.repoName }}`
- Ingress: `https://${{ values.repoName }}.local`

## Health

```bash
curl https://${{ values.repoName }}.local/health
```

Documentación generada con TechDocs a partir de este repositorio.