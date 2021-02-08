/**
 * Creates an invisible iframe with the given src and adds it to the page.
 */
export function createIframe(src: string) {
  const childFrame = document.createElement("iframe")!;
  childFrame.src = src;
  childFrame.style.display = "none";
  // Add the frame to the page.
  if (document.readyState === "complete" || document.readyState === "interactive") {
    document.body.appendChild(childFrame);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.appendChild(childFrame);
    });
  }

  return childFrame;
}
