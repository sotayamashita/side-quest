// Constants and global variables
const WINDOW_RATIO = 0.7;
let originalWindowSize = {};
let chatWindowTabId = null;

// Helper functions
function saveOriginalWindowSize(windowId, width, height) {
  originalWindowSize[windowId] = { width, height };
}

function restoreOriginalWindowSize(windowId) {
  if (originalWindowSize[windowId]) {
    chrome.windows.update(windowId, originalWindowSize[windowId]);
    delete originalWindowSize[windowId];
  }
}

chrome.action.onClicked.addListener((tab) => {
  console.log("Extension icon clicked. Tab:", tab);
  chrome.windows.get(tab.windowId, { populate: false }, (currentWindow) => {
    saveOriginalWindowSize(
      tab.windowId,
      currentWindow.width,
      currentWindow.height,
    );

    const mainWindowWidth = Math.floor(currentWindow.width * WINDOW_RATIO);
    const chatWindowWidth = currentWindow.width - mainWindowWidth;

    // Resize main window
    chrome.windows.update(tab.windowId, {
      width: mainWindowWidth,
      state: "normal",
    });

    createChatWindow(currentWindow, mainWindowWidth, chatWindowWidth, tab);
  });
});

function createChatWindow(
  currentWindow,
  mainWindowWidth,
  chatWindowWidth,
  originalTab,
) {
  chrome.windows.create(
    {
      url: "chat.html",
      type: "popup",
      width: chatWindowWidth,
      height: currentWindow.height,
      left: currentWindow.left + mainWindowWidth,
      top: currentWindow.top,
    },
    (chatWindow) => {
      console.log("Chat window created:", chatWindow);
      chatWindowTabId = chatWindow.tabs[0].id;

      setupChatWindowListeners(chatWindow, originalTab);
    },
  );
}

function setupChatWindowListeners(chatWindow, originalTab) {
  // Wait for the chat window to fully load
  chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
    if (tabId === chatWindow.tabs[0].id && info.status === "complete") {
      chrome.tabs.onUpdated.removeListener(listener);
      initializeChatWindow(originalTab, chatWindow.tabs[0].id);
    }
  });

  // Listener for when the chat window is closed
  chrome.windows.onRemoved.addListener(function listener(removedWindowId) {
    if (removedWindowId === chatWindow.id) {
      restoreOriginalWindowSize(originalTab.windowId);
      chrome.windows.onRemoved.removeListener(listener);
    }
  });
}

function initializeChatWindow(originalTab, chatWindowTabId) {
  chrome.tabs.get(originalTab.id, (tabInfo) => {
    if (chrome.runtime.lastError) {
      console.error(
        "An error occurred while retrieving tab information:",
        chrome.runtime.lastError,
      );
      return;
    }
    console.log("Tab information retrieved:", tabInfo);
    chrome.tabs.sendMessage(
      chatWindowTabId,
      {
        action: "initChat",
        title: tabInfo.title || "No title",
        url: tabInfo.url || "",
        favIconUrl: tabInfo.favIconUrl || "default-icon.png",
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "An error occurred while sending a message to the chat window:",
            chrome.runtime.lastError,
          );
        } else {
          console.log(
            "Message sent to chat window. Response:",
            response,
          );
        }
      },
    );
  });
}

async function callLLM(messages, model) {
  console.log("[background.js] callLLM function started");
  const settings = await chrome.storage.sync.get(["ollamaUrl", "defaultModel"]);
  console.log("[background.js] Settings retrieved:", settings);

  if (settings.ollamaUrl) {
    const modelToUse = model || settings.defaultModel || "llama2";
    console.log("[background.js] Model to use:", modelToUse);
    return callOllama(messages, settings.ollamaUrl, modelToUse);
  } else {
    console.error("[background.js] LLM settings not found");
    throw new Error(
      "LLM settings not found. Please configure them on the options page.",
    );
  }
}

async function callOllama(messages, url, model) {
  console.log("callOllama called with url:", url, "and model:", model);
  const requestBody = {
    model: model,
    prompt: messages[messages.length - 1].content,
    system: messages.find((m) => m.role === "system")?.content || "",
    context: [],
    stream: false,
  };
  console.log("Request body:", requestBody);

  try {
    const response = await fetch(`${url}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    console.log("Ollama API response status:", response.status);
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Ollama API error:", errorText);
      throw new Error(
        `Ollama API error: ${response.status} ${errorText}. URL: ${url}, Model: ${model}`,
      );
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error calling Ollama API:", error);
    throw error;
  }
}

async function handleSendMessage(request, sender) {
  console.log("handleSendMessage called with request:", request);
  try {
    const response = await callLLM(request.messages, request.model);
    console.log("Response received from callLLM:", response);
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "chatComplete",
      result: response.response,
    });
  } catch (error) {
    console.error("LLM call error:", error);
    chrome.tabs.sendMessage(sender.tab.id, {
      action: "chatError",
      error: error.message,
    });
  }
}

async function processStream(stream, tabId) {
  console.log("processStream started for tabId:", tabId);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("Stream reading complete");
        break;
      }

      const chunk = decoder.decode(value);
      console.log("Received chunk:", chunk);
      const parsedLines = parseChunk(chunk);

      for (const parsedLine of parsedLines) {
        const token = parsedLine.response;
        if (token) {
          result += token;
          chrome.tabs.sendMessage(tabId, {
            action: "updateChat",
            token: token,
          });
        }
      }
    }

    console.log("Final result:", result);
    chrome.tabs.sendMessage(tabId, {
      action: "chatComplete",
      result: result,
    });
  } catch (error) {
    console.error("Error processing stream:", error);
    chrome.tabs.sendMessage(tabId, {
      action: "chatError",
      error: error.message,
    });
  }
}

function parseChunk(chunk) {
  console.log("Parsing chunk:", chunk);
  return chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        console.error("Error parsing JSON:", error, "Line:", line);
        return null;
      }
    })
    .filter((parsed) => parsed !== null);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[background.js] Message received:", request);

  if (request.action === "callOllama") {
    console.log("[background.js] callOllama action detected");

    // Return true to indicate asynchronous processing
    (async () => {
      try {
        console.log("[background.js] Calling callLLM function");
        const response = await callLLM(request.messages, request.model);
        console.log("[background.js] callLLM response:", response);
        sendResponse(response);
      } catch (error) {
        console.error("[background.js] Error occurred:", error);
        sendResponse({ error: error.message });
      }
    })();

    return true; // Indicate asynchronous response
  } else if (request.action === "sendMessage") {
    console.log("[background.js] sendMessage action detected");
    handleSendMessage(request, sender);
    return true; // Indicate asynchronous response
  } else if (request.action === "openOptionsPage") {
    console.log("[background.js] openOptionsPage action detected");
    chrome.runtime.openOptionsPage();
  } else if (request.action === "openOriginalTab") {
    console.log("[background.js] openOriginalTab action detected");
    openOriginalTab(request.url);
  }

  console.log("[background.js] Listener processing completed");
});

function openOriginalTab(url) {
  chrome.tabs.query({}, (tabs) => {
    const existingTab = tabs.find((tab) => tab.url === url);
    if (existingTab) {
      chrome.tabs.update(existingTab.id, { active: true });
      chrome.windows.update(existingTab.windowId, { focused: true });
    } else {
      chrome.windows.getCurrent((currentWindow) => {
        chrome.tabs.create({ url: url, windowId: currentWindow.id });
      });
    }
  });
}

// Function to create context menu
function createContextMenu() {
  chrome.contextMenus.create(
    {
      id: "addToChat",
      title: "Add to Chat",
      contexts: ["selection"],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.log("Context menu item already exists");
      }
    },
  );
}

// Execute on extension installation or update
chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

// Context menu click event listener
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "addToChat") {
    if (chatWindowTabId) {
      chrome.tabs.sendMessage(
        chatWindowTabId,
        {
          action: "addQuoteToChat",
          quote: info.selectionText,
        },
        function (response) {
          if (chrome.runtime.lastError) {
            console.log(
              "Error occurred while sending message:",
              chrome.runtime.lastError.message,
            );
            // Reset tab ID as chat window might be closed
            chatWindowTabId = null;
          } else {
            console.log("Message sent successfully:", response);
          }
        },
      );
    } else {
      console.log("Chat window is not open");
    }
  }
});

// Add listener for when chat window is closed
chrome.windows.onRemoved.addListener(function (removedWindowId) {
  if (chatWindowTabId) {
    chrome.tabs.get(chatWindowTabId, function (tab) {
      if (chrome.runtime.lastError) {
        // Tab doesn't exist (window was closed)
        chatWindowTabId = null;
      }
    });
  }
});