# Operación del portal (día a día) + lecciones aprendidas

## Estado

```bash
# Argo: apps y health
kubectl -n argocd get app,appproject

# Pod y rollout del portal
kubectl -n workloads get pods -l app=backstage
kubectl -n workloads rollout status deploy/backstage --timeout=180s

# Contenido efectivo montado (verificar override/templates)
kubectl -n workloads exec deploy/backstage -- ls /app/config /app/templates /app/plugins
kubectl -n workloads exec deploy/backstage -- cat /app/config/override.yaml
```

## Tareas típicas

| Tarea | Comando |
|---|---|
| Sincronizar Argo | API/UI de `argocd.local` → app → Sync (o force-sync de `backstage-gitops`/`root-app`) |
| Cambiar un template/override/plugin | `gen_cm.py` → push → sync → `rollout restart deploy/backstage` |
| Reiniciar Backstage (BD volcada, plugin) | `kubectl -n workloads rollout restart deploy/backstage` |
| Ver logs | `kubectl -n workloads logs deploy/backstage --tail=300 -f` |
| DNS clientes | `/etc/hosts`: `192.168.100.77 <host>.local` |
| Inspeccionar catálogo | psql a `backstage_plugin_catalog` (ver `catalogo.md`) |
| Health | `curl -k https://<host>.local/` (puerto TLS 443 del Kong; nodeport 30910+kong) |

## Debug paso a paso de un *"no se ve en el catálogo"*

1. `refresh_state` de la entidad: `errors` y `next_update_at`.
2. Location: `locations.target` (¿raw? ¿404?).
3. owner: ¿existe `group:default/<g>`? (`groups.yaml`/Catalog).
4. El repo del usuario: ¿`catalog-info.yaml` servido por raw?
5. Tiempo de refresh: esperar el ciclo ~1–2 min tras el push del repo.

## Lecciones aprendidas (hard-won)

1. **Un emptyDir en varios mounts = raíz compartida**.
   El `readdir` ve el volumen completo en cada mount → separar por prefijo en 3
   emptyDirs fue el fix. **No volver a subPath para templates/plugins/config.**
2. **Merge de Backstage reemplaza arrays**.
   `catalog.locations`/`integrations` se definen completos en el override; nada de
   "añadir uno más" desde la imagen.
3. **catalog:register headless no es posible** sin sesión OAuth. Usar siempra
   `catalogInfoUrl` raw.
4. **`blob→tree` rompe el refresh** del catálogo: la URL estable es `raw`.
5. **Los header de PR con viñetas** fallaban el body → body en una sola línea.
6. **`directory.exclude: catalog-info.yaml`** debe ir como **string glob** en el
   CRD de Argo (no un array).
7. **Secretos de org no llegan a repos privados** → workloads públicos.
8. **El sincronismo CM↔rollout**: a veces un rollout coge el CM viejo
   (sync de Argo aún aplicando). Reintentar el rollout y verificar el fichero.
9. **`kubectl` del nodo pide fingerprint/PAM** (sudo): usar
   `echo 'plusultra' | sudo -S -p '' kubectl …` y colgar tiempo.
10. **TLS de Kong es `CN=localhost`** (sin SAN): advertencia del navegador, no bloquea.

## Valores de referencia

- Imagen Backstage: `docker.io/guslopezc/backstage:v12`.
- Bindings: pod `7007`, service ClusterIP `7007`, ingress Kong `backstage.local`.
- BD: StatefulSet `postgres` en `workloads`.
- CM: `backstage-templates` (generado por `gen_cm.py`).