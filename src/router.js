// TODO: Should the router be its own skapp?

export function runRouter() {
  // Display the router UI.

  // Open a window with a selection + field for "other".

  // Send message from window with chosen provider.

  // Listen for message with chosen provider.

  // Send the selected provider's skylink to the bridge in a 'completion' event.
  window.parent.postMessage(provider, "*");
}
