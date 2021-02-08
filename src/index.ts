import { Bridge } from "./bridge";
import { runRouter } from "./router";

const identityKey = "identity";
const providerUrl = "";

const minimumInterface = {
  identity: ["string"],
  isLoggedIn: ["bool"],
  login: [],
  logout: [],
};

if (typeof Storage == "undefined") {
  throw new Error("Browser does not support web storage");
}

// Launch the bridge.
const bridge = new IdentityBridge(minimumInterface);

export class IdentityBridge extends Bridge {}
