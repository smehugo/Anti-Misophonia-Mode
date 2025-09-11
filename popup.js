document.addEventListener('DOMContentLoaded', function () {
    // get all control elements
    const processingToggle = document.getElementById('enableProcessing');
    const debugToggle = document.getElementById('showDebug');
    
    // mode selector
    const clickMode = document.getElementById('clickMode');
    const smackMode = document.getElementById('smackMode');
    
    // sliders
    const sensitivitySlider = document.getElementById('sensitivitySlider');
    const frequencySkewSlider = document.getElementById('frequencySkewSlider');
    const clickWideningSlider = document.getElementById('clickWideningSlider');
    const reductionAmountSlider = document.getElementById('reductionAmountSlider');
    
    // value displays
    const sensitivityValue = document.getElementById('sensitivityValue');
    const frequencySkewValue = document.getElementById('frequencySkewValue');
    const clickWideningValue = document.getElementById('clickWideningValue');
    const reductionAmountValue = document.getElementById('reductionAmountValue');

    // default settings for aggressive mouth de-click
    const defaults = {
        processingEnabled: true,
        debugEnabled: false,
        mode: 'click',
        sensitivity: 0.8, // conservative default with exponential scaling
        frequencySkew: 0.0,
        clickWidening: 5,
        reductionAmount: -60
    };

    // load saved settings
    chrome.storage.sync.get(Object.keys(defaults), function (data) {
        const settings = { ...defaults, ...data };
        
        // set toggles
        processingToggle.checked = settings.processingEnabled;
        debugToggle.checked = settings.debugEnabled;
        
        // set mode
        updateModeButtons(settings.mode);
        
        // set sliders and update displays
        setSensitivity(settings.sensitivity);
        setFrequencySkew(settings.frequencySkew);
        setClickWidening(settings.clickWidening);
        setReductionAmount(settings.reductionAmount);
    });

    function updateAllTabs(type, value) {
        chrome.tabs.query({}, function (tabs) {
            tabs.forEach(tab => {
                chrome.tabs.sendMessage(tab.id, {
                    type,
                    value
                }).catch(() => { });
            });
        });
    }

    function updateModeButtons(activeMode) {
        clickMode.classList.toggle('active', activeMode === 'click');
        smackMode.classList.toggle('active', activeMode === 'smack');
    }

    function setSensitivity(value) {
        sensitivitySlider.value = value;
        sensitivityValue.textContent = value.toFixed(1);
    }

    function setFrequencySkew(value) {
        frequencySkewSlider.value = value;
        const labels = {
            '-1.0': 'low freq', '-0.5': 'low-mid', '0.0': 'mouth', 
            '0.5': 'mid-high', '1.0': 'high freq'
        };
        frequencySkewValue.textContent = labels[value.toFixed(1)] || `${value.toFixed(1)}`;
    }

    function setClickWidening(value) {
        clickWideningSlider.value = value;
        clickWideningValue.textContent = `${value}ms`;
    }

    function setReductionAmount(value) {
        reductionAmountSlider.value = value;
        if (value <= -60) {
            reductionAmountValue.textContent = 'complete';
        } else {
            reductionAmountValue.textContent = `${value}db`;
        }
    }

    // event listeners
    processingToggle.addEventListener('change', function (e) {
        const enabled = e.target.checked;
        chrome.storage.sync.set({ processingEnabled: enabled });
        updateAllTabs('toggleProcessing', enabled);
    });

    debugToggle.addEventListener('change', function (e) {
        const enabled = e.target.checked;
        chrome.storage.sync.set({ debugEnabled: enabled });
        updateAllTabs('toggleDebug', enabled);
    });

    // mode selection
    clickMode.addEventListener('click', function () {
        updateModeButtons('click');
        chrome.storage.sync.set({ mode: 'click' });
        updateAllTabs('updateMode', 'click');
    });

    smackMode.addEventListener('click', function () {
        updateModeButtons('smack');
        chrome.storage.sync.set({ mode: 'smack' });
        updateAllTabs('updateMode', 'smack');
    });

    // sensitivity slider
    sensitivitySlider.addEventListener('input', function (e) {
        const value = parseFloat(e.target.value);
        setSensitivity(value);
    });

    sensitivitySlider.addEventListener('change', function (e) {
        const value = parseFloat(e.target.value);
        chrome.storage.sync.set({ sensitivity: value });
        updateAllTabs('updateSensitivity', value);
    });

    // frequency skew slider
    frequencySkewSlider.addEventListener('input', function (e) {
        const value = parseFloat(e.target.value);
        setFrequencySkew(value);
    });

    frequencySkewSlider.addEventListener('change', function (e) {
        const value = parseFloat(e.target.value);
        chrome.storage.sync.set({ frequencySkew: value });
        updateAllTabs('updateFrequencySkew', value);
    });

    // click widening slider
    clickWideningSlider.addEventListener('input', function (e) {
        const value = parseInt(e.target.value);
        setClickWidening(value);
    });

    clickWideningSlider.addEventListener('change', function (e) {
        const value = parseInt(e.target.value);
        chrome.storage.sync.set({ clickWidening: value });
        updateAllTabs('updateClickWidening', value);
    });

    // reduction amount slider
    reductionAmountSlider.addEventListener('input', function (e) {
        const value = parseInt(e.target.value);
        setReductionAmount(value);
    });

    reductionAmountSlider.addEventListener('change', function (e) {
        const value = parseInt(e.target.value);
        chrome.storage.sync.set({ reductionAmount: value });
        updateAllTabs('updateReductionAmount', value);
    });
}); 