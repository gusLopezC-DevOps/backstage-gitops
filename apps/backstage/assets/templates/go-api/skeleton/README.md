# ${{ values.repoName }}

API JSON en Go desplegada por Argo CD.

- Imagen: `docker.io/guslopezc/${{ values.repoName }}`
- Namespace / AppProject / Application: `${{ values.repoName }}`
- Ingress: `https://${{ values.repoName }}.local`

## Local

```bash
go run .
```

Servidor stdlib que sirve `/health` y `/api/{{ repoName }}` en JSON.

## CI

`.github/workflows/ci.yml` construye y publica la imagen y actualiza la tag en
`deployment.yaml`; Argo CD (sync automatico con selfHeal) despliega el cambio.