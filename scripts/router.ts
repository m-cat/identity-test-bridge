import { ProviderMetadata, SkappInfo } from "skynet-interface-utils";
import urljoin from "url-join";

let submitted = false;

let skappInfo: SkappInfo | undefined = undefined;

// ======
// Events
// ======

// Event that is triggered when the window is closed.
window.onbeforeunload = () => {
  if (!submitted) {
    // Send value to signify that the router was closed.
    returnMessage("event", "closed");
  }

  return null;
};

window.onerror = function (error) {
  if (typeof error === "string") {
    returnMessage("error", error);
  } else {
    returnMessage("error", error.type);
  }
};

window.onload = async () => {
  // Get parameters.

  const urlParams = new URLSearchParams(window.location.search);
  const name = urlParams.get("skappName");
  if (!name) {
    returnMessage("error", "Parameter 'skappName' not found");
    return;
  }
  const domain = urlParams.get("skappDomain");
  if (!domain) {
    returnMessage("error", "Parameter 'skappDomain' not found");
    return;
  }

  // Set values.

  skappInfo = { name, domain };
};

// ============
// User Actions
// ============

// Function triggered by clicking "OK".
(window as any).submitProvider = async (): Promise<void> => {
  submitted = true;
  deactivateUI();

  // Get the value of the form.

  const radios = document.getElementsByName("provider-form-radio");

  let providerUrl = "";
  for (let i = 0, length = radios.length; i < length; i++) {
    const radio = <HTMLInputElement>radios[i];
    if (radio.checked) {
      providerUrl = radio.value;

      // Only one radio can be logically selected, don't check the rest.
      break;
    }
  }

  // Blank value means we should look at the "Other" field.
  if (providerUrl === "") {
    providerUrl = (<HTMLInputElement>document.getElementById("other-text"))!.value;
  }

  await handleProviderUrl(providerUrl);
}

async function handleProviderUrl(providerUrl: string): Promise<void> {
  // Set up event listener for provider metadata from the bridge.

  const promise: Promise<void> = new Promise((resolve, reject) => {
    const handleEvent = async ({ key, newValue }: StorageEvent) => {
      if (!key) {
        reject("Storage event data not found");
        return;
      }

      if (!["success-bridge", "error-bridge"].includes(key)) {
        return;
      }
      window.removeEventListener("storage", handleEvent);
      window.localStorage.removeItem(key);

      if (key === "success-bridge") {
        if (!newValue) {
          reject("Storage event data value not found");
          return;
        }
        const metadata = JSON.parse(newValue);
        await handleProviderMetadata(metadata);
        resolve();
      } else {
        if (key !== "error-bridge") {
          reject("Unknown key received");
        }
        reject(newValue);
      }
    };

    window.addEventListener("storage", handleEvent);
  });

  // Send the value to the bridge.

  returnMessage("success", providerUrl, true);

  // Wait on metadata from bridge.

  await promise;
}

async function handleProviderMetadata(metadata: ProviderMetadata): Promise<void> {
  if (!skappInfo) {
    returnMessage("error", "skapp info not found");
    return;
  }

  // Open the connector.

  // Build the connector URL.
  let connectorUrl = ensureUrl(metadata.url);
  connectorUrl = urljoin(connectorUrl, metadata.relativeConnectorPath);
  connectorUrl = `${connectorUrl}?skappName=${skappInfo.name}&skappDomain=${skappInfo.domain}`;
  // Navigate to the connector.
  window.location.replace(connectorUrl);
};

// ================
// Helper Functions
// ================

/**
 *
 */
export function activateUI() {
  document.getElementById("darkLayer")!.style.display = "none";
}

/**
 *
 */
export function deactivateUI() {
  document.getElementById("darkLayer")!.style.display = "";
}

function ensureUrl(url: string): string {
  if (!url.startsWith("https://")) {
    url = `https://${url}`;
  }
  return url;
}

function returnMessage(messageKey: "success" | "event" | "error", message: string, stayOpen = false) {
  const key = `${messageKey}-router`;
  window.localStorage.removeItem(key);
  window.localStorage.setItem(key, message);
  if (!stayOpen) {
    window.close();
  }
}
