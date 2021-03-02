import { ChildHandshake, WindowMessenger } from "post-me";
import type { Connection } from "post-me";

let submitted = false;
let bridgeWindow: Window | undefined = undefined;
let parentConnection: Connection | undefined = undefined;

// ======
// Events
// ======

// Event that is triggered when the window is closed.
window.onbeforeunload = () => {
  if (!submitted) {
    // Send value to signify that the router was closed.
    returnMessage("closed");
  }

  // Close the parent connection.
  if (parentConnection) {
    parentConnection.close();
  }

  return null;
};

window.onerror = function (error) {
  returnMessage(error);
};

window.onload = async () => {
  // Enable communication with opening skapp.

  const methods = {
    setFrameName: (name: string) => {
      bridgeWindow = window.opener[name];
    },
  };
  const messenger = new WindowMessenger({
    localWindow: window,
    remoteWindow: window.opener,
    remoteOrigin: "*",
  });
  parentConnection = await ChildHandshake(messenger, methods);
};

// ============
// User Actions
// ============

// Function triggered by clicking "OK".
(window as any).submitProvider = async () => {
  submitted = true;

  // Get the value of the form.
  const radios = document.getElementsByName("provider-form-radio");

  let providerValue = "";
  for (let i = 0, length = radios.length; i < length; i++) {
    const radio = <HTMLInputElement>radios[i];
    if (radio.checked) {
      providerValue = radio.value;

      // Only one radio can be logically selected, don't check the rest.
      break;
    }
  }

  // Blank value means we should look at the "Other" field.
  if (providerValue === "") {
    providerValue = (<HTMLInputElement>document.getElementById("other-text"))!.value;
  }

  if (!bridgeWindow) {
    // Send error message and close window.
    await returnMessage("Could not find bridge window");
    window.close();
    return;
  }

  // Send the value to the bridge.
  bridgeWindow.postMessage(providerValue, location.origin);

  // Send success message to opener.
  await returnMessage("success");

  // Close this window.
  window.close();
};

// ================
// Helper Functions
// ================

async function returnMessage(result: string | Event): Promise<void> {
  if (parentConnection) {
    return parentConnection.localHandle().emit("result", result);
  }
}
