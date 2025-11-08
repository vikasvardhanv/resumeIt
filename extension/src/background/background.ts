/* Service Worker (Background) */
import { MessageType } from '../types/messages';

chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case MessageType.JobExtracted: {
          sendResponse({ ok: true });
          break;
        }
        case MessageType.TailorRequest: {
          sendResponse({ ok: false, error: 'Tailoring requests must be initiated from the popup UI.' });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e: any) {
      console.error('Background error', e);
      sendResponse({ ok: false, error: e?.message || 'Unhandled error' });
    }
  })();
  return true; // Keep channel open for async
});
