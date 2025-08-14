
// Background Service Worker
chrome.runtime.onInstalled.addListener(() => {
  console.log('Phishing Detector Extension Installed');

  try {
    // Set default badge
    chrome.action.setBadgeText({ text: '🛡️' }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error setting badge text:', chrome.runtime.lastError);
      }
    });
    chrome.action.setBadgeBackgroundColor({ color: '#00cec9' }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error setting badge background color:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.error('Error during extension initialization:', error);
  }
});

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      const url = new URL(tab.url);
      const domain = url.hostname;

      // Skip non-web protocols and restricted URLs
      if (!url.protocol.startsWith('http') || 
          url.protocol === 'chrome:' || 
          url.protocol === 'chrome-extension:' || 
          url.protocol === 'moz-extension:' ||
          url.protocol === 'file:' ||
          url.protocol === 'data:' ||
          !domain) {
        return;
      }

      // Check if domain is suspicious
      if (isSuspiciousDomain(domain)) {
        chrome.action.setBadgeText({ text: '⚠️', tabId: tabId }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error setting warning badge:', chrome.runtime.lastError);
          }
        });
        chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId: tabId }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error setting warning badge color:', chrome.runtime.lastError);
          }
        });
        
        // Send message to content script to show warning (content script is already injected via manifest)
        setTimeout(() => {
          // Verify tab still exists before sending message
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              console.warn(`Tab ${tabId} no longer exists`);
              return;
            }
            
            chrome.tabs.sendMessage(tabId, {
              action: 'showPhishingWarning',
              domain: domain,
              indicators: getPhishingIndicators(domain)
            }, (response) => {
              if (chrome.runtime.lastError) {
                console.warn(`Content script not available on ${domain}:`, chrome.runtime.lastError.message);
                // Content script might not be ready yet, try again after a short delay
                setTimeout(() => {
                  chrome.tabs.get(tabId, (retryTab) => {
                    if (chrome.runtime.lastError || !retryTab) {
                      console.warn(`Tab ${tabId} no longer exists for retry`);
                      return;
                    }
                    
                    chrome.tabs.sendMessage(tabId, {
                      action: 'showPhishingWarning',
                      domain: domain,
                      indicators: getPhishingIndicators(domain)
                    }, () => {
                      if (chrome.runtime.lastError) {
                        console.warn(`Content script still not available on ${domain} after retry:`, chrome.runtime.lastError.message);
                      }
                    });
                  });
                }, 1000);
              }
            });
          });
        }, 500); // Small delay to ensure content script is loaded
      } else {
        chrome.action.setBadgeText({ text: '🛡️', tabId: tabId }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error setting safe badge:', chrome.runtime.lastError);
          }
        });
        chrome.action.setBadgeBackgroundColor({ color: '#00cec9', tabId: tabId }, () => {
          if (chrome.runtime.lastError) {
            console.error('Error setting safe badge color:', chrome.runtime.lastError);
          }
        });
      }
    } catch (e) {
      console.warn('Invalid URL encountered:', tab.url, e.message);
      // Set default badge for invalid URLs
      chrome.action.setBadgeText({ text: '🛡️', tabId: tabId }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error setting default badge for invalid URL:', chrome.runtime.lastError);
        }
      });
      chrome.action.setBadgeBackgroundColor({ color: '#00cec9', tabId: tabId }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error setting default badge color for invalid URL:', chrome.runtime.lastError);
        }
      });
    }
  }
});

function isSuspiciousDomain(domain) {
  const suspiciousPatterns = [
    /\d+\.\d+\.\d+\.\d+/, // IP addresses
    /[a-z]+-[a-z]+\.(tk|ml|ga|cf)$/, // Suspicious TLDs
    /[a-z]+[0-9]+\.(com|net|org)$/, // Numbers in domain
    /.{20,}/, // Very long domains
    /paypal-[a-z]+\.(com|net)/, // Fake PayPal domains
    /amazon-[a-z]+\.(com|net)/, // Fake Amazon domains
    /google-[a-z]+\.(com|net)/, // Fake Google domains
    /microsoft-[a-z]+\.(com|net)/, // Fake Microsoft domains
  ];

  return suspiciousPatterns.some(pattern => pattern.test(domain));
}

function getPhishingIndicators(domain) {
  const indicators = [];
  
  if (/\d+\.\d+\.\d+\.\d+/.test(domain)) {
    indicators.push('Domain uses IP address instead of domain name');
  }
  
  if (/[a-z]+-[a-z]+\.(tk|ml|ga|cf)$/.test(domain)) {
    indicators.push('Suspicious top-level domain (.tk, .ml, .ga, .cf)');
  }
  
  if (/[a-z]+[0-9]+\.(com|net|org)$/.test(domain)) {
    indicators.push('Domain contains suspicious number patterns');
  }
  
  if (/.{20,}/.test(domain)) {
    indicators.push('Unusually long domain name');
  }
  
  if (/paypal-[a-z]+\.(com|net)/.test(domain)) {
    indicators.push('Potential PayPal impersonation attempt');
  }
  
  if (/amazon-[a-z]+\.(com|net)/.test(domain)) {
    indicators.push('Potential Amazon impersonation attempt');
  }
  
  if (/google-[a-z]+\.(com|net)/.test(domain)) {
    indicators.push('Potential Google impersonation attempt');
  }
  
  if (/microsoft-[a-z]+\.(com|net)/.test(domain)) {
    indicators.push('Potential Microsoft impersonation attempt');
  }
  
  return indicators.length > 0 ? indicators : ['Suspicious domain pattern detected'];
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    if (request.action === 'logBehavior') {
      // Store risky behavior
      chrome.storage.local.get(['riskBehaviors'], (result) => {
        try {
          const behaviors = result.riskBehaviors || [];
          
          // Validate the data before storing
          if (request.data && typeof request.data === 'object') {
            behaviors.push({
              ...request.data,
              timestamp: Date.now() // Add timestamp if not present
            });
            
            chrome.storage.local.set({ riskBehaviors: behaviors }, () => {
              if (chrome.runtime.lastError) {
                console.error('Error storing risk behavior:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                console.log('Risk behavior logged successfully');
                sendResponse({ success: true });
              }
            });
          } else {
            console.error('Invalid behavior data received:', request.data);
            sendResponse({ success: false, error: 'Invalid data format' });
          }
        } catch (storageError) {
          console.error('Error processing behavior data:', storageError);
          sendResponse({ success: false, error: storageError.message });
        }
      });
      
      // Return true to indicate we will send a response asynchronously
      return true;
    }
  } catch (error) {
    console.error('Error handling message:', error);
    sendResponse({ success: false, error: error.message });
  }
});

// Initialize extension and check authentication on install
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension started up');
  checkUserAuthentication();
});

// Also check authentication when extension is installed/updated
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Extension installed for the first time');
  } else if (details.reason === 'update') {
    console.log('Extension updated');
  }
  
  // Check for user authentication
  checkUserAuthentication();
});

// Check User Authentication
function checkUserAuthentication() {
  fetch('http://127.0.0.1:5000/api/check-auth', {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json'
    },
    // Add timeout to prevent hanging requests
    signal: AbortSignal.timeout(10000) // 10 second timeout
  })
    .then(response => {
      if (response.ok) {
        return response.json();
      }
      // Handle different HTTP status codes
      if (response.status === 401) {
        throw new Error('User not authenticated (401)');
      } else if (response.status === 403) {
        throw new Error('Access forbidden (403)');
      } else if (response.status === 404) {
        throw new Error('Authentication endpoint not found (404)');
      } else if (response.status >= 500) {
        throw new Error(`Server error (${response.status})`);
      } else {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }
    })
    .then(data => {
      if (data && typeof data.is_authenticated !== 'undefined') {
        if (!data.is_authenticated) {
          chrome.storage.local.set({ 'needs_login': true });
          console.log('User is not authenticated. Prompting to log in.');
        } else {
          chrome.storage.local.set({ 'needs_login': false });
          console.log('User is authenticated.');
        }
      } else {
        console.warn('Invalid response format from authentication endpoint');
        chrome.storage.local.set({ 'needs_login': true });
      }
    })
    .catch(error => {
      // Handle different types of errors
      if (error.name === 'AbortError') {
        console.error('Authentication check timed out. Please check your internet connection.');
      } else if (error.name === 'TypeError') {
        console.error('Network error during authentication check. Server may be unreachable:', error.message);
      } else {
        console.error('Error checking authentication:', error.message);
      }
      
      // Set needs_login to true on any error to be safe
      chrome.storage.local.set({ 'needs_login': true });
      
      // Optionally retry after a delay
      setTimeout(() => {
        console.log('Retrying authentication check...');
        checkUserAuthentication();
      }, 30000); // Retry after 30 seconds
    });
}