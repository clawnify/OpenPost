import { useState, useEffect, useCallback } from "preact/hooks";
import { reportLocation } from "@clawnify/app/client";
import type { View } from "../types";

interface RouterState {
  view: View;
  editId: number | null;
}

function parseLocation(): RouterState {
  const path = window.location.pathname;
  if (path === "/calendar") return { view: "calendar", editId: null };
  if (path === "/queue") return { view: "queue", editId: null };
  if (path === "/drafts") return { view: "drafts", editId: null };
  if (path === "/channels") return { view: "channels", editId: null };
  if (path === "/analytics") return { view: "analytics", editId: null };
  if (path === "/compose") return { view: "compose", editId: null };
  if (path.startsWith("/compose/")) {
    const id = Number(path.split("/")[2]);
    return { view: "compose", editId: isNaN(id) ? null : id };
  }
  return { view: "dashboard", editId: null };
}

export function useRouter() {
  const [state, setState] = useState<RouterState>(parseLocation);

  useEffect(() => {
    const onPop = () => setState(parseLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Report every route change so the workspace can reopen this screen on reload.
  useEffect(() => {
    reportLocation(window.location.pathname + window.location.search);
  }, [state.view, state.editId]);

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    setState(parseLocation());
  }, []);

  return { view: state.view, editId: state.editId, navigate };
}
