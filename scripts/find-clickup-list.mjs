const API_BASE = 'https://api.clickup.com/api/v2';

const token = process.env.CLICKUP_API_TOKEN;
const workspaceName = process.env.CLICKUP_WORKSPACE_NAME || 'DT Enterprises';
const listName = process.env.CLICKUP_LIST_NAME || 'Canary Data';

if (!token) {
  console.error('Missing CLICKUP_API_TOKEN.');
  process.exit(1);
}

async function clickup(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: token },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    throw new Error(payload?.err || payload?.message || `ClickUp returned ${response.status} for ${path}`);
  }

  return payload;
}

async function getListsForSpace(spaceId) {
  const folderPayload = await clickup(`/space/${spaceId}/folder?archived=false`);
  const folders = folderPayload.folders || [];
  const nestedLists = [];

  for (const folder of folders) {
    const listPayload = await clickup(`/folder/${folder.id}/list?archived=false`);
    nestedLists.push(
      ...(listPayload.lists || []).map((list) => ({
        ...list,
        folder_name: folder.name,
      }))
    );
  }

  const folderlessPayload = await clickup(`/space/${spaceId}/list?archived=false`);
  const folderlessLists = (folderlessPayload.lists || []).map((list) => ({
    ...list,
    folder_name: null,
  }));

  return [...nestedLists, ...folderlessLists];
}

const teamsPayload = await clickup('/team');
const teams = teamsPayload.teams || [];
const team = teams.find((candidate) => candidate.name === workspaceName);

if (!team) {
  console.error(`Could not find ClickUp workspace "${workspaceName}". Available workspaces:`);
  for (const candidate of teams) console.error(`- ${candidate.name} (${candidate.id})`);
  process.exit(1);
}

const spacesPayload = await clickup(`/team/${team.id}/space?archived=false`);
const spaces = spacesPayload.spaces || [];
const matches = [];

for (const space of spaces) {
  const lists = await getListsForSpace(space.id);
  for (const list of lists) {
    if (list.name === listName) {
      matches.push({
        workspace: team.name,
        workspace_id: team.id,
        space: space.name,
        space_id: space.id,
        folder: list.folder_name,
        list: list.name,
        list_id: list.id,
      });
    }
  }
}

if (matches.length === 0) {
  console.error(`Could not find list "${listName}" in workspace "${workspaceName}".`);
  process.exit(1);
}

console.log(JSON.stringify(matches, null, 2));
