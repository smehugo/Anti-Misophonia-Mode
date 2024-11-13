document.addEventListener('DOMContentLoaded', function () {
    const processingToggle = document.getElementById('enableProcessing');
    const debugToggle = document.getElementById('showDebug');
    const sensitivitySlider = document.getElementById('sensitivitySlider');
    const sensitivityValue = document.getElementById('sensitivityValue');

    // Get initial states
    chrome.storage.sync.get(
        ['processingEnabled', 'debugEnabled', 'sensitivity'],
        function (data) {
            processingToggle.checked = data.processingEnabled !== false;
            debugToggle.checked = data.debugEnabled === true;

            // Set slider to saved value or default
            const sensitivity = data.sensitivity || 100;
            sensitivitySlider.value = sensitivity;
            sensitivityValue.textContent = `${sensitivity}%`;
        }
    );

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

    // Handle sensitivity slider
    sensitivitySlider.addEventListener('input', function (e) {
        const value = parseInt(e.target.value);
        sensitivityValue.textContent = `${value}%`;
    });

    sensitivitySlider.addEventListener('change', function (e) {
        const value = parseInt(e.target.value);
        chrome.storage.sync.set({ sensitivity: value });
        updateAllTabs('updateSensitivity', value / 100);
    });
}); 