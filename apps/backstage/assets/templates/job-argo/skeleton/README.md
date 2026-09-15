# ${{ values.repoName }}

Job / CronJob en Go desplegado por Argo CD (sync manual).

- Imagen: `docker.io/guslopezc/${{ values.repoName }}`
- Namespace / AppProject / Application: `${{ values.repoName }}`
- Cron: `${{ values.schedule }}`

## Local

```bash
go run .
```

## CI

`.github/workflows/ci.yml` construye y publica la imagen y actualiza la tag en
`cronjob.yaml`. Argo CD esta configurado con **sync manual** (sin automated),
asi que despues del merge del PR hay que sincronizar manualmente en la UI.