let originalWindowSize = {};
let chatWindowTabId = null;

const CHAT_WINDOW_WIDTH = 400; // Define the width of the chat window
const WINDOW_HEIGHT = 600; // Define the height of the window

function displayExtensionId() {
  const extensionId = chrome.runtime.id;
  const extensionIdInfo = document.getElementById("extension-id-info");
  extensionIdInfo.textContent = `Extension ID: ${extensionId}`;

  const ollamaStartCommand = document.getElementById("ollama-start-command");
  ollamaStartCommand.textContent = `OLLAMA_ORIGINS=chrome-extension://${extensionId} ollama serve`;
}

function createChatWindow(tab) {
  chrome.windows.get(tab.windowId, { populate: true }, (window) => {
    originalWindowSize = { width: window.width, height: window.height };

    chrome.windows.create(
      {
        url: "chat.html",
        type: "popup",
        width: CHAT_WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        left: window.left + originalWindowSize.width,
        top: window.top,
      },
      (chatWindow) => {
        console.log("Chat window created:", chatWindow);
        chatWindowTabId = chatWindow.tabs[0].id;

        initializeChatWindow();
      },
    );
  });
}

function initializeChatWindow() {
  chrome.storage.sync.get(["ollamaModels", "defaultModel"], (data) => {
    chrome.tabs.sendMessage(
      chatWindowTabId,
      {
        action: "initChat",
        chatWidth: CHAT_WINDOW_WIDTH,
        chatHeight: WINDOW_HEIGHT,
        ollamaModels: data.ollamaModels || [],
        defaultModel: data.defaultModel || "",
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.log(
            "Error sending message to chat window:",
            chrome.runtime.lastError.message,
          );
        } else {
          console.log("Message sent to chat window. Response:", response);
        }
      },
    );
  });
}

function handleContextMenuClick(info, tab) {
  if (info.menuItemId === "addToChat") {
    if (chatWindowTabId) {
      chrome.tabs.sendMessage(
        chatWindowTabId,
        {
          action: "addQuoteToChat",
          quote: info.selectionText,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.log(
              "Error sending message to chat window:",
              chrome.runtime.lastError.message,
            );
            chatWindowTabId = null;
          } else {
            console.log("Message sent to chat window. Response:", response);
          }
        },
      );
    } else {
      console.log("Chat window is not open.");
    }
  }
}

function handleWindowRemoved(removedWindowId) {
  if (chatWindowTabId) {
    chrome.tabs.get(chatWindowTabId, (tab) => {
      if (chrome.runtime.lastError) {
        chatWindowTabId = null;
      }
    });
  }
}

function handleMessage(request, sender, sendResponse) {
  if (request.action === "openOptionsPage") {
    chrome.runtime.openOptionsPage();
  } else if (request.action === "sendMessage") {
    (async () => {
      try {
        const stream = await callLLM(request.messages);
        // ... Stream processing code ...
      } catch (error) {
        console.error("LLM call error:", error);
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "chatError",
          error: error.message,
        });
      }
    })();
    return true; // Indicate asynchronous response
  }
}

async function callLLM(messages) {
  const settings = await chrome.storage.sync.get(["ollamaUrl", "defaultModel"]);

  if (settings.ollamaUrl && settings.defaultModel) {
    return callOllama(messages, settings.ollamaUrl, settings.defaultModel);
  } else {
    throw new Error(
      "LLM settings not found. Please set them in the options page.",
    );
  }
}

async function callOllama(messages, url, model) {
  const response = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
    }),
  });
  return response.body;
}

async function loadSettings() {
  console.log("loadSettings");
  const settings = await chrome.storage.sync.get([
    "ollamaUrl",
    "defaultModel",
    "ollamaModels",
  ]);

  document.getElementById("ollama-url").value =
    settings.ollamaUrl || "http://localhost:11434";

  const defaultModelSelect = document.getElementById("default-model");
  defaultModelSelect.innerHTML = ""; // Clear existing options

  if (settings.ollamaModels && settings.ollamaModels.length > 0) {
    settings.ollamaModels.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      defaultModelSelect.appendChild(option);
    });

    // Set default model
    defaultModelSelect.value =
      settings.defaultModel || settings.ollamaModels[0];
  } else {
    // Placeholder if models couldn't be retrieved
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Failed to retrieve models";
    defaultModelSelect.appendChild(option);
  }

  displayExtensionId();
}

async function verifyOllama() {
  const ollamaUrl = document.getElementById("ollama-url").value;
  const verificationResult = document.getElementById("verification-result");
  const availableModels = document.getElementById("available-models");
  const defaultModelSelect = document.getElementById("default-model");
  const extensionId = chrome.runtime.id;

  try {
    const response = await fetch(`${ollamaUrl}/api/tags`);
    if (!response.ok) {
      throw new Error("Unable to connect to Ollama server");
    }
    const data = await response.json();

    verificationResult.textContent = "Connection successful!\n\n";
    verificationResult.textContent += `To use this extension with Ollama, start Ollama with the following command:\n\n`;
    verificationResult.textContent += `OLLAMA_ORIGINS=chrome-extension://${extensionId} ollama serve\n\n`;
    verificationResult.textContent += `Make sure to replace ${extensionId} with your actual extension ID if it's different.`;
    verificationResult.classList.remove("hidden");

    // Clear existing models
    availableModels.innerHTML = "";
    defaultModelSelect.innerHTML = "";

    // Display model list and set default model selection
    if (data.models && data.models.length > 0) {
      const uniqueModels = new Set();
      data.models.forEach((model) => {
        const modelName = model.name.split(":")[0]; // Get model name without tags
        uniqueModels.add(modelName);
      });

      uniqueModels.forEach((modelName) => {
        // Add to available models list
        const li = document.createElement("li");
        li.textContent = modelName;
        availableModels.appendChild(li);

        // Add to default model selection
        const option = document.createElement("option");
        option.value = modelName;
        option.textContent = modelName;
        defaultModelSelect.appendChild(option);
      });

      // Set the first model as default if not already set
      if (!defaultModelSelect.value) {
        defaultModelSelect.value = Array.from(uniqueModels)[0];
      }

      // Save settings
      await chrome.storage.sync.set({
        ollamaModels: Array.from(uniqueModels),
        defaultModel: defaultModelSelect.value,
      });
    } else {
      throw new Error("No models found");
    }
  } catch (error) {
    verificationResult.textContent = `Error: ${error.message}`;
    verificationResult.classList.remove("hidden");

    // Clear models on error
    availableModels.innerHTML = "<li>No available models</li>";
    defaultModelSelect.innerHTML =
      '<option value="">No available models</option>';
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const ollamaUrl = document.getElementById("ollama-url").value;
  const defaultModel = document.getElementById("default-model").value;

  await chrome.storage.sync.set({ ollamaUrl, defaultModel });
  console.log("Settings saved");
}

function initializeOptionsPage() {
  loadSettings(); // This will populate the fields with saved data and display the extension ID

  const form = document.getElementById("settings-form");
  const verifyButton = document.getElementById("verify-ollama");

  form.addEventListener("submit", saveSettings);
  verifyButton.addEventListener("click", verifyOllama);
}

// Make sure this is at the end of your file
document.addEventListener("DOMContentLoaded", initializeOptionsPage);

chrome.action.onClicked.addListener(createChatWindow);
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);
chrome.windows.onRemoved.addListener(handleWindowRemoved);
chrome.runtime.onMessage.addListener(handleMessage);

// Create context menu conditionally
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "addToChat",
    title: "Add to Chat",
    contexts: ["selection"],
  });
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "sync") {
    if (changes.ollamaUrl) {
      console.log("Ollama URL setting changed:", changes.ollamaUrl.newValue);
    }
    if (changes.ollamaModels) {
      console.log("Ollama models changed:", changes.ollamaModels.newValue);
    }
    if (changes.defaultModel) {
      console.log("Default model changed:", changes.defaultModel.newValue);
    }
  }
});
