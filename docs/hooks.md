---
sidebarDepth: 2
---

# Hooks

## changesById

|before|after|methods|multi|details|
|---|---|---|---|---|
|yes|yes|`create`, `patch`, `update`, `remove`|yes|[source](https://github.com/fratzinger/feathers-notify/blob/main/lib/hooks/changesById.ts)|

### Options

|       Property      |                Description                  |
|---------------------|---------------------------------------------|
| `params` | With the `params` options, you can manipulate params for `changesById` if you need to.<br><br>**Type:** `(params: Params, context: HookContext) => (Params \| Promise<Params>)`<br>**optional** - *Default:* `undefined` |
| `refetchItems` | As an after-hook refetch <br><br>**Type:** `boolean`<br>**optional** - *Default:* `false` |
| `skipHooks`| Use `find` or `_find` for refetching<br><br>**Type:** `boolean`<br>**optional** - *Default:* `false` |

## notify

|before|after|methods|multi|details|
|---|---|---|---|---|
|yes|yes|`create`, `patch`, `update`, `remove`|yes|[source](https://github.com/fratzinger/feathers-notify/blob/main/lib/hooks/notify.ts)|

### Options

|       Property      |                Description                  |
|---------------------|---------------------------------------------|