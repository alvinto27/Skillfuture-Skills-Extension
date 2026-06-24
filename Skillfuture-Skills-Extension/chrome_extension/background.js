chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== "skillsfutureBackendFetch") {
        return false;
    }

    const { url, options } = message;
    fetch(url, options)
        .then(async (response) => {
            const data = await response.json().catch(() => null);
            sendResponse({
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                data,
            });
        })
        .catch((error) => {
            sendResponse({
                ok: false,
                status: error.status || 0,
                statusText: error.message,
                error: error.message,
            });
        });

    return true;
});