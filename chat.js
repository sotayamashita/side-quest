let chatMessages = [];

const DOM = {
  chatMessages: document.getElementById("chat-messages"),
  chatInput: document.getElementById("chat-input"),
  sendButton: document.getElementById("send-button"),
  settingsIcon: document.getElementById("settings-icon"),
  pageIcon: document.getElementById("page-icon"),
  pageTitle: document.getElementById("page-title"),
  pageUrl: document.getElementById("page-url"),
  quoteContainer: document.getElementById("quote-container"),
  quoteText: document.getElementById("quote-text"),
  modelSelect: document.getElementById("model-select"),
};

let currentModel = "";
let currentAssistantMessage = "";

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function addMessageToChat(role, content, isStreaming = false) {
  console.log(
    "[chat.js] addMessageToChat function started:",
    role,
    content,
    isStreaming,
  );
  if (isStreaming && role === "assistant") {
    if (!currentAssistantMessage) {
      const messageDiv = document.createElement("div");
      messageDiv.classList.add("mb-4", "mr-auto", "w-full");
      messageDiv.innerHTML = `
                <div class="inline-block text-left w-full">
                    <p class="text-sm assistant-message"></p>
                </div>
            `;
      DOM.chatMessages.appendChild(messageDiv);
    }
    currentAssistantMessage += content;
    const assistantMessageElement = DOM.chatMessages.querySelector(
      ".assistant-message:last-child",
    );
    if (assistantMessageElement) {
      assistantMessageElement.textContent = currentAssistantMessage;
    }
  } else {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("mb-4");

    if (role === "user") {
      messageDiv.classList.add("ml-auto", "w-full");
      messageDiv.innerHTML = `
                <div class="bg-gray-100 p-2 rounded-md border border-gray-300 inline-block text-left w-full mb-2">
                    <p class="text-sm">${escapeHtml(content)}</p>
                </div>
            `;
    } else if (role === "assistant") {
      messageDiv.classList.add("mr-auto", "w-full");
      messageDiv.innerHTML = `
                <div class="inline-block p-2 text-left w-full">
                    <p class="text-sm">${escapeHtml(content)}</p>
                </div>
            `;
      currentAssistantMessage = "";
    } else if (role === "error") {
      messageDiv.classList.add(
        "mx-auto",
        "text-center",
        "text-red-500",
        "w-full",
      );
      messageDiv.innerHTML = `<p class="text-sm">${escapeHtml(content)}</p>`;
    }

    DOM.chatMessages.appendChild(messageDiv);
  }
  DOM.chatMessages.scrollTop = DOM.chatMessages.scrollHeight;
  console.log("[chat.js] addMessageToChat function ended");
}

function addQuoteToChat(quote) {
  DOM.quoteText.textContent = quote;
  DOM.quoteContainer.classList.remove("hidden");
}

function sendMessage() {
  console.log("[chat.js] sendMessage function started");
  const message = DOM.chatInput.value.trim();
  const quote = DOM.quoteText.textContent.trim();
  
  if (message) {
    let fullMessage = message;
    let displayMessage = message;
    if (quote) {
      fullMessage = `<quote>${quote}</quote>\n\n${message}`;
      displayMessage = `Quote: "${quote}"\n\n${message}`;
    }

    addMessageToChat("user", displayMessage);
    chatMessages.push({ role: "user", content: fullMessage });

    DOM.chatInput.value = "";
    DOM.quoteContainer.classList.add("hidden");
    DOM.quoteText.textContent = "";

    console.log("[chat.js] Message sent:", {
      action: "callOllama",
      messages: chatMessages,
      url: "http://localhost:11434",
      model: currentModel,
    });

    chrome.runtime.sendMessage(
      {
        action: "callOllama",
        messages: chatMessages,
        url: "http://localhost:11434",
        model: currentModel,
      },
      (response) => {
        console.log("[chat.js] Response received:", response);
        if (chrome.runtime.lastError) {
          console.error(
            "[chat.js] Chrome runtime error:",
            chrome.runtime.lastError,
          );
          addMessageToChat(
            "error",
            "Chrome runtime error occurred. Please check the console for details.",
          );
          return;
        }
        if (response && response.response) {
          addMessageToChat("assistant", response.response);
          chatMessages.push({ role: "assistant", content: response.response });
        } else {
          console.error("[chat.js] Invalid response:", response);
          addMessageToChat(
            "error",
            "Invalid response received. Please check the console for details.",
          );
        }
      },
    );
  }
  console.log("[chat.js] sendMessage function ended");
}

function initializeChatWindow() {
  chrome.runtime.sendMessage({ action: "getChatState" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(
        "Error occurred while retrieving chat state:",
        chrome.runtime.lastError,
      );
      return;
    }

    if (response && response.chatState) {
      chatMessages = response.chatState.messages || [];
      chatMessages.forEach((msg) => addMessageToChat(msg.role, msg.content));

      if (response.chatState.pageInfo) {
        DOM.pageIcon.src = response.chatState.pageInfo.favIconUrl;
        DOM.pageTitle.textContent = response.chatState.pageInfo.title;
        DOM.pageUrl.textContent = response.chatState.pageInfo.url;
      }
    }
  });
}

function setupEventListeners() {
  DOM.sendButton.addEventListener("click", sendMessage);
  DOM.chatInput.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });
  DOM.settingsIcon.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openOptionsPage" });
  });

  DOM.chatInput.addEventListener('input', function() {
    adjustTextareaHeight(this);
  });

  adjustTextareaHeight(DOM.chatInput);

  const deleteQuoteButton = document.createElement("button");
  deleteQuoteButton.textContent = "×";
  deleteQuoteButton.classList.add("delete-quote", "text-gray-500", "hover:text-gray-700", "ml-2");
  DOM.quoteContainer.appendChild(deleteQuoteButton);

  deleteQuoteButton.addEventListener("click", () => {
    DOM.quoteContainer.classList.add("hidden");
    DOM.quoteText.textContent = "";
  });
}

function handleChromeMessage(request, sender, sendResponse) {
  console.log("[chat.js] Message received in chat window:", request);
  switch (request.action) {
    case "initChat":
      console.log("[chat.js] initChat action received:", request);
      DOM.pageIcon.src = request.favIconUrl || "default-icon.png";
      DOM.pageTitle.textContent = request.title || "No title";
      DOM.pageUrl.textContent = request.url || "";
      console.log("Chat window initialized:", request);
      sendResponse({ status: "Chat window initialized" });
      chrome.storage.sync.get(["ollamaModels", "defaultModel"], (data) => {
        populateModelSelect(data.ollamaModels || [], data.defaultModel || "");
      });
      break;
    case "updateChat":
      const assistantMessage = document.querySelector(
        ".chat-message.assistant:last-child",
      );
      assistantMessage.textContent += request.token;
      break;
    case "chatComplete":
      addMessageToChat("assistant", request.result);
      chatMessages.push({ role: "assistant", content: request.result });
      break;
    case "addQuoteToChat":
      addQuoteToChat(request.quote);
      sendResponse({ status: "Quote added to chat" });
      break;
    case "chatError":
      console.error("[chat.js] Chat error:", request.error);
      console.error("[chat.js] Error stack trace:", new Error().stack);
      addMessageToChat(
        "error",
        `Error: ${request.error}. Please check the console for details.`,
      );
      break;
  }
  return true; // Indicates asynchronous response
}

function populateModelSelect(models, defaultModel) {
  DOM.modelSelect.innerHTML = "";

  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    DOM.modelSelect.appendChild(option);
  });

  if (defaultModel && models.includes(defaultModel)) {
    DOM.modelSelect.value = defaultModel;
  }

  currentModel = DOM.modelSelect.value;

  DOM.modelSelect.addEventListener("change", (event) => {
    currentModel = event.target.value;
  });
}

function adjustTextareaHeight(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("Chat window DOM fully loaded and parsed");
  initializeChatWindow();
  setupEventListeners();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[chat.js] Message received:", request);
  if (request.action === "streamResponse") {
    addMessageToChat("assistant", request.content, true);
  } else if (request.action === "completeResponse") {
    chatMessages.push({ role: "assistant", content: currentAssistantMessage });
    currentAssistantMessage = "";
  }
});

chrome.runtime.onMessage.addListener(handleChromeMessage);