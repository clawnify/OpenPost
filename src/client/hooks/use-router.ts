import { useState, useEffect, useCallback } from "preact/hooks";
import type { View } from "../types";

interface RouterState {
  view: View;
  editId: number | null;
  // The location itself, so the host bridge can report it verbatim.
  path: string;
}

function parseLocation(): RouterState {
  const path = window.location.pathname;
  const here = path + window.location.search;
  if (path === "/calendar") return { view: "calendar", editId: null, path: here };
  if (path === "/queue") return { view: "queue", editId: null, path: here };
  if (path === "/drafts") return { view: "drafts", editId: null, path: here };
  if (path === "/channels") return { view: "channels", editId: null, path: here };
  if (path === "/analytics") return { view: "analytics", editId: null, path: here };
  if (path === "/compose") return { view: "compose", editId: null, path: here };
  if (path.startsWith("/compose/")) {
    const id = Number(path.split("/")[2]);
    return { view: "compose", editId: isNaN(id) ? null : id, path: here };
  }
  return { view: "dashboard", editId: null, path: here };
}

export function useRouter() {
  const [state, setState] = useState<RouterState>(parseLocation);

  useEffect(() => {
    const onPop = () => setState(parseLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setState(parseLocation());
  }, []);

  return { view: state.view, editId: state.editId, path: state.path, navigate };
}
