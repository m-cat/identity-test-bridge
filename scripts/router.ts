let submitted = false;

// Event triggered by clicking "OK".
(window as any).submitProvider = () => {
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

  // Send the value back to launchRouter().
  window.opener.postMessage(providerValue, location.origin);

  // Close this window.
  submitted = true;
  window.close();
};

// Event that is triggered when the window is closed.
window.onbeforeunload = () => {
  if (!submitted) {
    // Send a blank value to signify that the router failed.
    window.opener.postMessage("", location.origin);
  }

  return null;
};
