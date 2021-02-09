import { Bridge } from "./bridge";
import type { Interface } from "./bridge";

class IdentityBridge extends Bridge {
  // TODO: Make interfaces accept parameters?
  static minimumInterface: Interface = {
    identity: ["string"],
    isLoggedIn: ["bool"],
    login: [],
    logout: [],
  };

  constructor() {
    super(IdentityBridge.minimumInterface);
  }
}

// ===============
// START EXECUTION
// ===============

if (typeof Storage == "undefined") {
  throw new Error("Browser does not support web storage");
}

// Launch the bridge.
new IdentityBridge();
