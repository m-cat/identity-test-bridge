// TODO: Enable full eslint lints.

import { Bridge } from "./bridge";

class IdentityBridge extends Bridge {
  // TODO: Make interfaces accept parameters?
  static bridgeInfo = {
    minimumInterface: {
      identity: ["string"],
      isLoggedIn: ["bool"],
      login: [],
      logout: [],
    },
    relativeRouterUrl: "router.html"
  };

  constructor() {
    super(IdentityBridge.bridgeInfo);
  }
}

// ===============
// START EXECUTION
// ===============

// Launch the bridge.
new IdentityBridge();
