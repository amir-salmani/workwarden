// Bitwarden's wire format for a cipher and a folder, defined once. /api/sync
// and the CRUD routes both read these, so the two cannot drift into
// disagreeing about a field -- which would desync clients while every test
// stayed green.

export type CipherRow = {
  id: string
  user_id: string
  folder_id: string | null
  type: number
  data: string
  favorite: number
  reprompt: number
  created_at: string
  revision_date: string
  deleted_at: string | null
}

export type FolderRow = {
  id: string
  user_id: string
  name: string
  created_at: string
  revision_date: string
}

// Every server-owned field here was found by driving a real client:
//   attachments          null or an array; the `{}` a client sends on create
//                        crashes it when echoed back.
//   organizationUseTotp  a non-optional bool in the client's Rust SDK.
//   key                  the per-cipher key; must be present even when null,
//                        and must be the client's own value when it has one.
//   permissions          absent means delete and restore are refused.
export function cipherJson(r: CipherRow) {
  const data = JSON.parse(r.data) as Record<string, unknown>
  return {
    ...data,
    id: r.id,
    organizationId: null,
    folderId: r.folder_id,
    type: r.type,
    favorite: r.favorite === 1,
    reprompt: r.reprompt,
    edit: true,
    viewPassword: true,
    permissions: { delete: true, restore: true },
    collectionIds: [],
    attachments: null,
    organizationUseTotp: true,
    key: data.key ?? null,
    creationDate: r.created_at,
    revisionDate: r.revision_date,
    deletedDate: r.deleted_at,
    object: 'cipherDetails',
  }
}

export function folderJson(r: FolderRow) {
  return { id: r.id, name: r.name, revisionDate: r.revision_date, object: 'folder' }
}
