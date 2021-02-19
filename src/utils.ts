/**
 * Creates an invisible iframe with the given src and adds it to the page.
 */
export function createIframe(srcUrl: string, name: string): HTMLIFrameElement {
  srcUrl = ensureUrl(srcUrl);

  const childFrame = document.createElement("iframe")!;
  childFrame.src = srcUrl;
  childFrame.name = name;
  childFrame.style.display = "none";

  // Set sandbox permissions.
  // TODO: Enable sandboxing?
  // childFrame.sandbox.add("allow-same-origin");
  // childFrame.sandbox.add("allow-scripts");

  document.body.appendChild(childFrame);
  return childFrame;
}

export function ensurePrefix(s: string, prefix: string): string {
  if (!s.startsWith(prefix)) {
    s = `${prefix}${s}`;
  }
  return s;
}

export function ensureUrl(url: string): string {
  return ensurePrefix(url, "https://");
}
