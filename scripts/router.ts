let submitted = false;

// ======
// Events
// ======

// Event that is triggered when the window is closed.
window.onbeforeunload = () => {
  if (!submitted) {
    // Send value to signify that the router was closed.
    returnMessage("closed");
  }

  return null;
};

window.onerror = function (error) {
  returnMessage(error);
};

window.onload = async () => {};

// ============
// User Actions
// ============

// Function triggered by clicking "OK".
(window as any).submitProvider = () => {
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

  // Send the value to the bridge.
  window.localStorage.setItem("receivedProviderUrl", providerValue);

  // Send success message to opener.
  returnMessage("success");

  // Close this window.
  window.close();
};

// ================
// Helper Functions
// ================

function returnMessage(message: string | Event) {
  window.opener.postMessage(message, "*");
  window.close();
}
