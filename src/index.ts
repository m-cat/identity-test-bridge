// TODO: Enable full eslint lints.

import { Bridge } from "./bridge";
import { routerName, routerW, routerH } from "./consts";

class IdentityBridge extends Bridge {
  // TODO: Make interfaces accept parameters?
  static bridgeInfo = {
    minimumInterface: {
      identity: ["string"],
      isLoggedIn: ["bool"],
      login: [],
      logout: [],
    },
    relativeRouterUrl: "router.html",
    routerName,
    routerW,
    routerH
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
