# ${{ repoName }}

Microservicio Python/FastAPI desplegado por Argo CD.

- Imagen: `docker.io/guslopezc/${{ repoName }}`
- Namespace / AppProject / Application: `${{ repoName }}`
- Ingress: `https://${{ repoName }}.local`

## Local

```bash
pip install -r app/requirements.txt
uvicorn app.main:app --reload --port 8000
```

## CI

`.github/workflows/ci.yml` construye y publica la imagen y actualiza la tag en
`deployment.yaml`; Argo CD (sync automatico con selfHeal) desplega el cambio.