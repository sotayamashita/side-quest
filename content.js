console.log("Content script loaded");

chrome.runtime.sendMessage(
  {
    action: "callOllama",
    messages: messages,
    url: url,
    model: model,
  },
  (response) => {
    if (chrome.runtime.lastError) {
      console.error("Error:", chrome.runtime.lastError.message);
      return;
    }

    if (response && response.success) {
      console.log("Response:", response);
      // Process the response
    } else {
      console.error("Error:", response ? response.error : "Unknown error");
    }
  },
);
