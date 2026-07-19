// Temporary hand-off store for the "start engine" action: Home stashes the
// files + requirement here, then navigates to the Process page which performs
// the actual API call. Mirrors the original MiroFish store/pendingUpload.js.

type PendingUpload = {
  files: File[];
  simulationRequirement: string;
  isPending: boolean;
};

const state: PendingUpload = {
  files: [],
  simulationRequirement: '',
  isPending: false,
};

export function setPendingUpload(files: File[], requirement: string) {
  state.files = files;
  state.simulationRequirement = requirement;
  state.isPending = true;
}

export function getPendingUpload(): PendingUpload {
  return { files: state.files, simulationRequirement: state.simulationRequirement, isPending: state.isPending };
}

export function clearPendingUpload() {
  state.files = [];
  state.simulationRequirement = '';
  state.isPending = false;
}

export default state;
