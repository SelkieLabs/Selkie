/**
 * A note in this browser that someone was signed in here last time.
 *
 * Privy takes a second or two to confirm a session, and until it does the front
 * page cannot know whether to show the landing or open the wallet. Returning
 * visitors were left looking at the landing, then yanked to their wallet. With
 * this hint the root layout marks them before the first paint, so they see the
 * loader and go straight to the wallet. It proves nothing: the wallet still
 * waits for the real session and sends anyone without one back to the front.
 */
export const SESSION_HINT_KEY = "selkie.session";

export function rememberSession(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(SESSION_HINT_KEY, "1");
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Storage blocked: returning visitors just see the landing for a moment.
  }
}

/**
 * Runs inline in <head>, before anything paints. Plain ES5 on purpose: it is a
 * string, not a module, and must never throw.
 */
export const RETURNING_SCRIPT = `try{if(location.pathname==="/"&&localStorage.getItem("${SESSION_HINT_KEY}")==="1")document.documentElement.setAttribute("data-returning","")}catch(e){}`;
