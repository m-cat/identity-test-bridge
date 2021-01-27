import Postmate from "postmate";

import { runRouter } from "./router";

const storageKey = 'identity-test-bridge';

const bridge = new IdentityBridge();

export class IdentityBridge {
  constructor() {
	if (typeof(Storage) == 'undefined') {
	  throw new Error('Browser does not support web storage')
	}

    // Load bridge state.

    // Try to access local storage for 'identity-test-bridge'.
    this.identity = localStorage.getItem(storageKey);

    if (!this.identity) {
      this.isLoggedIn = false;
    } else {
      this.isLoggedIn = true;
    }

    // Enable communication with parent skapp.

    const handshake = new Postmate.Model({
      identity: () => this.identity,
      isLoggedIn: () => this.isLoggedIn,
      login: this.login,
      logout: this.logout,
    });
    this.handshake = handshake;
  }

  login() {
    setIdentity(this, "moomoo");
    return;

    // Create iframe with router.
    //
    // TODO: Should this open a window instead?
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.sandbox = "allow-scripts";
    iframe.setAttribute(
      "srcdoc",
      `<html><body>
         <script>
           runRouter();
         </script>
       </body></html>`
    );
    const origin = new URL(iframe.src).origin;

    // Add iframe to the skapp.
    document.body.appendChild(iframe);

    // Listen for completion message from child frame.
    // TODO: Prevent receiving from router window here?
    window.addEventListener("message", (event) => {
      if (event.origin !== origin) {
        return;
      }

      // Destroy the iframe.
      iframe.parentNode.removeChild(iframe);

      // Set the identity we received.
      setIdentity(this, "tester");
    });
  }

  logout() {
    localStorage.removeItem(storageKey);
    this.identity = "";
    this.isLoggedIn = false;
  }
}

function setIdentity(bridge, identity) {
  localStorage.setItem(storageKey, identity);
  bridge.identity = identity;
  bridge.isLoggedIn = true;
}
