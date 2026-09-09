from fastapi import FastAPI

app = FastAPI(title="${{ parameters.repoName }}", version="0.1.0")


@app.get("/")
def root() -> dict:
    return {"message": "Hello from ${{ parameters.repoName }}"}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}