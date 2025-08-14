
// Content Script - Detects fake login pages (FR1-FR7)
class PhishingDetector {
  constructor() {
    this.knownDomains = {
      'google.com': ['google', 'gmail', 'sign in'],
      'facebook.com': ['facebook', 'log in', 'connect'],
      'instagram.com': ['instagram', 'log in'],
      'twitter.com': ['twitter', 'log in', 'sign in'],
      'linkedin.com': ['linkedin', 'sign in'],
      'microsoft.com': ['microsoft', 'outlook', 'sign in'],
      'apple.com': ['apple', 'sign in', 'apple id'],
      'amazon.com': ['amazon', 'sign in'],
      'paypal.com': ['paypal', 'log in'],
      'github.com': ['github', 'sign in']
    };
    this.whitelistedDomains = [];
    this.riskBehaviors = [];
    this.init();
  }

  init() {
    // Check if we're on a valid page that can be analyzed
    if (!this.isValidPage()) {
      return;
    }
    
    try {
      this.loadWhitelist();
      this.detectLoginForms();
      this.setupFormMonitoring();
      
      // Listen for messages from background script and popup
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'showPhishingWarning') {
          this.showWarning(null, request.indicators);
          sendResponse({success: true});
        } else if (request.action === 'reportSite') {
          this.reportSite();
          sendResponse({success: true});
        }
        return true;
      });
    } catch (error) {
      console.error('PhishingDetector initialization error:', error);
    }
  }
  
  isValidPage() {
    // Skip restricted pages and non-HTML documents
    const url = window.location.href;
    const restrictedProtocols = ['chrome:', 'chrome-extension:', 'moz-extension:', 'about:', 'data:', 'javascript:'];
    
    for (const protocol of restrictedProtocols) {
      if (url.startsWith(protocol)) {
        return false;
      }
    }
    
    // Check if document is ready and is HTML
    return document.documentElement && document.body && document.contentType !== 'application/pdf';
  }

  // FR1: Detects <form> with password fields
  detectLoginForms() {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
      const passwordFields = form.querySelectorAll('input[type="password"]');
      if (passwordFields.length > 0) {
        this.analyzeForm(form);
      }
    });
  }

  // FR2: Extracts title, headers, logos
  extractPageBranding() {
    const title = document.title.toLowerCase();
    const headers = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => h.textContent.toLowerCase());
    
    const logos = Array.from(document.querySelectorAll('img'))
      .filter(img => img.alt && (
        img.alt.toLowerCase().includes('logo') || 
        img.className.toLowerCase().includes('logo')
      ))
      .map(img => img.alt.toLowerCase());

    return { title, headers: headers.join(' '), logos: logos.join(' ') };
  }

  // FR3 & FR4: Compares branding with domain and alerts on mismatch
  analyzeForm(form) {
    const currentDomain = window.location.hostname.toLowerCase();
    const branding = this.extractPageBranding();
    
    if (this.isWhitelisted(currentDomain)) {
      return;
    }

    const suspiciousIndicators = this.checkForSuspiciousIndicators(currentDomain, branding);
    
    if (suspiciousIndicators.length > 0) {
      this.logRiskyBehavior({
        type: 'suspicious_login_page',
        domain: currentDomain,
        indicators: suspiciousIndicators,
        timestamp: new Date().toISOString()
      });
      
      this.showWarning(form, suspiciousIndicators);
    }
  }

  checkForSuspiciousIndicators(domain, branding) {
    const indicators = [];
    const allText = `${branding.title} ${branding.headers} ${branding.logos}`.toLowerCase();
    
    // Check if page claims to be a known service but domain doesn't match
    for (const [trustedDomain, keywords] of Object.entries(this.knownDomains)) {
      if (!domain.includes(trustedDomain)) {
        for (const keyword of keywords) {
          if (allText.includes(keyword)) {
            indicators.push(`Claims to be ${trustedDomain} but domain is ${domain}`);
            break;
          }
        }
      }
    }

    // Check for suspicious domain patterns
    if (this.hasSuspiciousDomainPattern(domain)) {
      indicators.push('Suspicious domain pattern detected');
    }

    return indicators;
  }

  hasSuspiciousDomainPattern(domain) {
    const suspiciousPatterns = [
      /\d+\.\d+\.\d+\.\d+/, // IP addresses
      /[a-z]+-[a-z]+\.(tk|ml|ga|cf)$/, // Suspicious TLDs
      /[a-z]+[0-9]+\.(com|net|org)$/, // Numbers in domain
      /.{20,}/, // Very long domains
    ];
    
    return suspiciousPatterns.some(pattern => pattern.test(domain));
  }

  // FR7: Optionally blocks form submission
  setupFormMonitoring() {
    document.addEventListener('submit', (event) => {
      const form = event.target;
      const passwordFields = form.querySelectorAll('input[type="password"]');
      
      if (passwordFields.length > 0) {
        const currentDomain = window.location.hostname.toLowerCase();
        
        if (!this.isWhitelisted(currentDomain) && this.isHighRisk(currentDomain)) {
          event.preventDefault();
          this.showBlockWarning();
          
          this.logRiskyBehavior({
            type: 'attempted_login_on_suspicious_site',
            domain: currentDomain,
            blocked: true,
            timestamp: new Date().toISOString()
          });
        }
      }
    });
  }

  isHighRisk(domain) {
    const branding = this.extractPageBranding();
    const indicators = this.checkForSuspiciousIndicators(domain, branding);
    return indicators.length >= 2; // High risk if multiple indicators
  }

  showWarning(form, indicators) {
    // Remove existing warning if present
    const existingWarning = document.getElementById('phishing-warning-overlay');
    if (existingWarning) {
      existingWarning.remove();
    }

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'phishing-warning-overlay';
    overlay.className = 'phishing-warning-overlay';
    
    // Add styles
    const style = document.createElement('style');
    style.id = 'phishing-warning-styles';
    style.textContent = `
      .phishing-warning-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(5px);
        z-index: 999999;
        display: flex;
        justify-content: center;
        align-items: center;
        animation: fadeIn 0.3s ease-out;
      }
      .phishing-warning-content {
        background: linear-gradient(135deg, #e74c3c, #c0392b);
        color: white;
        padding: 30px;
        border-radius: 15px;
        text-align: center;
        box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        max-width: 500px;
        width: 90%;
        animation: scaleIn 0.4s ease-out;
      }
      .warning-icon {
        font-size: 48px;
        animation: pulse 2s infinite ease-in-out;
        display: inline-block;
        margin-bottom: 20px;
      }
      .phishing-btn {
        padding: 12px 24px;
        border-radius: 8px;
        border: none;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        margin: 0 8px;
      }
      .phishing-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      }
      .btn-report {
        background: #ff4444;
        color: white;
      }
      .btn-trust {
        background: #27ae60;
        color: white;
      }
      .btn-dismiss {
        background: #95a5a6;
        color: white;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes scaleIn {
        from { transform: scale(0.9); opacity: 0; }
        to { transform: scale(1); opacity: 1; }
      }
      @keyframes pulse {
        0% { transform: scale(1); }
        50% { transform: scale(1.1); }
        100% { transform: scale(1); }
      }
    `;
    
    if (!document.getElementById('phishing-warning-styles')) {
      document.head.appendChild(style);
    }

    // Create warning content
    const warning = document.createElement('div');
    warning.className = 'phishing-warning-content';
    
    const indicatorsHtml = indicators.map(indicator => 
      `<div style="margin: 8px 0; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 5px; font-size: 14px;">• ${indicator}</div>`
    ).join('');

    warning.innerHTML = `
      <div class="warning-icon">⚠️</div>
      <h2 style="color: #fff; font-size: 24px; margin: 0 0 15px 0;">PHISHING WARNING</h2>
      <p style="font-size: 16px; margin: 15px 0; line-height: 1.4;">
        This page may be impersonating a legitimate service.<br>
        Issues detected: Suspicious domain pattern detected
      </p>
      <div style="margin: 20px 0; text-align: left;">
        ${indicatorsHtml}
      </div>
      <div style="margin-top: 25px;">
        <button class="phishing-btn btn-dismiss" onclick="window.phishingDetector.dismissWarning()">Dismiss</button>
        <button class="phishing-btn btn-trust" onclick="window.phishingDetector.trustSite()">Trust This Site</button>
        <button class="phishing-btn btn-report" onclick="window.phishingDetector.reportSite()">Report</button>
      </div>
    `;
    
    overlay.appendChild(warning);
    document.body.appendChild(overlay);
  }

  trustSite() {
    this.whitelist(window.location.hostname);
    this.dismissWarning();
  }

  dismissWarning() {
    const overlay = document.getElementById('phishing-warning-overlay');
    if (overlay) {
      overlay.remove();
    }
    // Remove styles as well
    const styles = document.getElementById('phishing-warning-styles');
    if (styles) {
      styles.remove();
    }
  }

  reportSite() {
    // Log the phishing report
    chrome.runtime.sendMessage({
      action: 'logBehavior',
      data: {
        type: 'phishing_report',
        domain: window.location.hostname,
        url: window.location.href,
        timestamp: Date.now(),
        userAgent: navigator.userAgent
      }
    });
    
    // Show confirmation
    alert('Thank you for reporting this suspicious site. The information has been logged.');
    this.dismissWarning();
  }

  whitelist(domain) {
    // Add domain to whitelist in storage
    chrome.storage.local.get(['whitelistedDomains'], (result) => {
      const whitelist = result.whitelistedDomains || [];
      if (!whitelist.includes(domain)) {
        whitelist.push(domain);
        chrome.storage.local.set({ whitelistedDomains: whitelist });
      }
    });
    
    // Log the trust action
    chrome.runtime.sendMessage({
      action: 'logBehavior',
      data: {
        type: 'site_trusted',
        domain: domain,
        url: window.location.href,
        timestamp: Date.now()
      }
    });
  }

  showBlockWarning() {
    const message = 'Login blocked due to high phishing risk. This site has been flagged as potentially dangerous.';
    this.showNotification(message, 'error');
  }

  showNotification(message, type = 'warning') {
    const notification = document.createElement('div');
    let icon, bgColor;
    
    switch(type) {
      case 'error':
        icon = '🚫';
        bgColor = '#e74c3c';
        break;
      case 'success':
        icon = '✅';
        bgColor = '#27ae60';
        break;
      default:
        icon = '⚠️';
        bgColor = '#f39c12';
    }
    
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${bgColor};
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 999999;
      animation: slideInRight 0.3s ease-out;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 200px;
      max-width: 400px;
    `;

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideInRight {
        from { transform: translateX(120%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(style);

    notification.innerHTML = `
      <span style="font-size: 18px;">${icon}</span>
      <span style="flex-grow: 1;">${message}</span>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease-out';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }

  // FR5: Allows whitelisting
  whitelist(domain) {
    if (!this.whitelistedDomains.includes(domain)) {
      this.whitelistedDomains.push(domain);
      chrome.storage.local.set({ whitelistedDomains: this.whitelistedDomains }, () => {
        this.showNotification(`${domain} has been added to trusted sites`, 'success');
        this.dismissWarning();
      });
    } else {
      this.showNotification(`${domain} is already in trusted sites`, 'warning');
      this.dismissWarning();
    }
  }

  isWhitelisted(domain) {
    return this.whitelistedDomains.includes(domain);
  }

  loadWhitelist() {
    chrome.storage.local.get(['whitelistedDomains'], (result) => {
      this.whitelistedDomains = result.whitelistedDomains || [];
    });
  }

  // FR6: Allows reporting
  async reportSite() {
    const data = {
      url: window.location.href,
      domain: window.location.hostname,
      title: document.title,
      timestamp: new Date().toISOString(),
      branding: this.extractPageBranding(),
      indicators: this.checkForSuspiciousIndicators(window.location.hostname, this.extractPageBranding())
    };
    
    try {
      // Send to backend for analysis
      const response = await fetch('https://employee-risk-calculator--5000.prod1b.defang.dev/api/report-phishing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      
      if (response.ok) {
        this.showNotification('Thank you for reporting this site. It will be reviewed by our security team.', 'success');
        this.dismissWarning();
      } else {
        throw new Error('Failed to report site');
      }
    } catch (error) {
      this.showNotification('Failed to report site. Please try again later.', 'error');
      console.log('Failed to report site:', error);
    }
  }
  }

  // FR11: Log risky clicks or behavior
  logRiskyBehavior(behavior) {
    this.riskBehaviors.push(behavior);
    
    // Send to backend for risk scoring
    fetch('https://employee-risk-calculator--5000.prod1b.defang.dev/api/log-behavior', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(behavior)
    }).catch(() => {
      // Store locally if offline
      chrome.storage.local.get(['riskBehaviors'], (result) => {
        const behaviors = result.riskBehaviors || [];
        behaviors.push(behavior);
        chrome.storage.local.set({ riskBehaviors: behaviors });
      });
    });
  }
}

  showNotification(type, message) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 8px;
      color: white;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 999999;
      animation: slideIn 0.3s ease-out;
      box-shadow: 0 4px 15px rgba(0,0,0,0.2);
      max-width: 300px;
    `;

    notification.style.background = type === 'success' ? '#27ae60' : '#e74c3c';

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease-in forwards';
      setTimeout(() => notification.remove(), 300);
    }, 5000);
  }

// Initialize detector
window.phishingDetector = new PhishingDetector();
