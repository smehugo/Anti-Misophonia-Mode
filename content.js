// Debug configuration
const DEBUG = false;

function log(...args) {
    if (DEBUG) console.log(...args);
}

function handleError(error, context) {
    if (DEBUG) console.error(`Error in ${context}:`, error);
}

class AdvancedMouthDeClicker {
    constructor(context) {
        // initialize audio context and processing nodes
        this.audioContext = context;
        this.clickCount = 0;
        this.sampleRate = context.sampleRate;

        // core processing nodes
        this.analyser = this.audioContext.createAnalyser();
        this.inputGain = this.audioContext.createGain();
        this.outputGain = this.audioContext.createGain();
        this.clickGain = this.audioContext.createGain();

        // enhanced buffering system - ~120ms lookahead for better analysis quality
        this.bufferSize = Math.floor(this.sampleRate * 0.12); // 120ms buffer
        this.delayNode = this.audioContext.createDelay(0.2);
        this.delayNode.delayTime.value = 0.12;

        // configure analysis parameters for high-quality mouth click detection
        this.analyser.fftSize = 8192; // larger fft for better frequency resolution
        this.analyser.smoothingTimeConstant = 0;
        this.frameSize = 1024; // larger frame size for better analysis
        this.hopSize = 256;
        this.windowSize = this.frameSize;

        // lpc analysis parameters
        this.lpcOrder = 16;
        this.predictionBuffer = new Float32Array(this.bufferSize);
        this.circularBuffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;

        // multi-band frequency analysis with cached bin indices
        this.freqBands = {
            low: { min: 100, max: 800 },
            mid: { min: 800, max: 2500 },
            high: { min: 2500, max: 8000 },
            mouth: { min: 2000, max: 5000 } // primary mouth click range
        };
        
        // cache frequency bin indices for performance
        this.freqBinCache = null;
        this.cacheSampleRate = 0;

        // set up audio processing chain
        this.inputGain.connect(this.analyser);
        this.inputGain.connect(this.delayNode);
        this.delayNode.connect(this.clickGain);
        this.clickGain.connect(this.outputGain);
        this.outputGain.connect(this.audioContext.destination);

        // analysis buffers
        this.timeData = new Float32Array(this.analyser.frequencyBinCount);
        this.freqData = new Float32Array(this.analyser.frequencyBinCount);
        this.previousSpectrum = new Float32Array(this.analyser.frequencyBinCount);
        this.spectralHistory = [];
        
        // performance optimization: frame-based processing
        this.frameCounter = 0;
        this.processingInterval = 3; // balanced processing frequency
        this.lastProcessingTime = 0;
        this.targetProcessingRate = 60; // max 60 fps processing
        
        // dynamic loudness adaptation
        this.loudnessHistory = new Array(30).fill(-60); // 30 frame history
        this.adaptiveThreshold = 0.35;
        this.backgroundNoiseLevel = -40;
        this.signalToNoiseRatio = 1.0;
        
        // click rate limiting to prevent stuttering
        this.clickHistory = []; // track recent clicks
        this.maxClicksPerSecond = 8; // maximum clicks to process per second
        this.minClickInterval = 125; // minimum 125ms between clicks
        this.lastClickTime = 0;
        this.clickSuppressionTime = 0; // time when we're suppressing clicks
        
        this.debugElement = null;
        this.debugEnabled = false;
        this.hostname = window.location.hostname;

        // advanced mouth de-click parameters
        this.params = {
            // sensitivity control (0.1 to 2.0, default 1.0)
            sensitivity: 1.0,
            
            // frequency skew (-1.0 to 1.0, 0 = mouth focus, negative = low freq, positive = high freq)
            frequencySkew: 0.0,
            
            // click widening in milliseconds (1-20ms, default 5ms)
            clickWidening: 5.0,
            
            // reduction amount in db (-60 to 0, default -inf for complete removal)
            reductionAmount: -60,
            
            // processing mode: 'click' for sharp transients, 'smack' for longer wet sounds
            mode: 'click',
            
            // conservative detection thresholds (prevent over-processing)
            thresholds: {
                lpcError: 0.018,       // more conservative prediction error threshold
                spectralFlux: 0.16,    // higher spectral change threshold
                transientRatio: 2.8,   // more selective transient detection
                mouthBandEnergy: 0.012, // higher energy threshold
                confidenceThreshold: 0.65, // higher confidence required
                dynamicRange: 2.5,     // dynamic range multiplier
                adaptiveBoost: 1.0     // adaptive boost factor
            },
            
            // frequency weighting for detection
            freqWeights: {
                low: 0.2,    // 100-800 hz
                mid: 0.6,    // 800-2500 hz  
                high: 1.0,   // 2500-8000 hz
                mouth: 1.5   // 2000-5000 hz (primary mouth click range)
            }
        };

        this.smoothedValues = {
            confidence: 0,
            lowToHighRatio: 0,
            midToLowRatio: 0,
            rms: 0
        };
        this.smoothingFactor = 0.85;

        // load advanced user settings
        chrome.storage.sync.get([
            'debugEnabled', 'processingEnabled', 'siteSettings', 
            'mode', 'sensitivity', 'frequencySkew', 'clickWidening', 'reductionAmount'
        ], (data) => {
            // debug settings
            if (data.debugEnabled) {
                this.createDebugDisplay();
                this.debugEnabled = true;
            }

            // processing enabled state
            const siteSettings = data.siteSettings || {};
            this.processingEnabled = this.hostname in siteSettings ?
                siteSettings[this.hostname] :
                data.processingEnabled !== false;

            if (!this.processingEnabled) {
                this.clickGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
            }

            // load advanced parameters
            if (data.mode) this.params.mode = data.mode;
            if (data.sensitivity) this.params.sensitivity = data.sensitivity;
            if (data.frequencySkew !== undefined) this.params.frequencySkew = data.frequencySkew;
            if (data.clickWidening) this.params.clickWidening = data.clickWidening;
            if (data.reductionAmount !== undefined) this.params.reductionAmount = data.reductionAmount;
            
            if (DEBUG) {
                log('Advanced parameters loaded:', this.params);
            }
        });
    }

    // optimized linear prediction coding analysis for outlier detection
    computeLPCCoefficients(signal, order) {
        const n = signal.length;
        
        // early exit for insufficient data
        if (n < order * 2) {
            return { coefficients: new Array(order + 1).fill(0), error: 1.0 };
        }
        
        const r = new Array(order + 1).fill(0);
        
        // optimized autocorrelation computation
        for (let k = 0; k <= order; k++) {
            const limit = n - k;
            for (let i = 0; i < limit; i++) {
                r[k] += signal[i] * signal[i + k];
            }
            r[k] /= limit;
        }
        
        // early exit if no signal energy
        if (r[0] < 1e-10) {
            return { coefficients: new Array(order + 1).fill(0), error: 1.0 };
        }
        
        // levinson-durbin algorithm with stability checks
        const a = new Array(order + 1).fill(0);
        a[0] = 1;
        let e = r[0];
        
        for (let i = 1; i <= order; i++) {
            let lambda = 0;
            for (let j = 1; j < i; j++) {
                lambda += a[j] * r[i - j];
            }
            
            if (Math.abs(e) < 1e-10) break; // avoid division by zero
            
            lambda = (r[i] - lambda) / e;
            
            // stability check
            if (Math.abs(lambda) >= 1.0) break;
            
            // update coefficients
            for (let j = 1; j < i; j++) {
                const temp = a[j];
                a[j] = temp - lambda * a[i - j];
            }
            a[i] = lambda;
            e *= (1 - lambda * lambda);
        }
        
        return { coefficients: a, error: Math.max(e, 1e-10) };
    }
    
    // compute prediction error signal using lpc
    computePredictionError(signal, lpcCoeffs) {
        const error = new Float32Array(signal.length);
        const order = lpcCoeffs.length - 1;
        
        for (let i = order; i < signal.length; i++) {
            let prediction = 0;
            for (let j = 1; j <= order; j++) {
                prediction += lpcCoeffs[j] * signal[i - j];
            }
            error[i] = signal[i] - prediction;
        }
        
        return error;
    }
    
    // initialize cached frequency bin indices for performance
    initFreqBinCache() {
        if (this.cacheSampleRate === this.sampleRate && this.freqBinCache) {
            return; // cache is still valid
        }
        
        this.cacheSampleRate = this.sampleRate;
        this.freqBinCache = {};
        
        const binCount = this.analyser.frequencyBinCount;
        
        for (const [bandName, band] of Object.entries(this.freqBands)) {
            this.freqBinCache[bandName] = {
                minBin: Math.floor(band.min * binCount / this.sampleRate),
                maxBin: Math.floor(band.max * binCount / this.sampleRate)
            };
        }
    }
    
    // optimized band energy calculation using cached bin indices
    calculateBandEnergy(freqData, minFreq, maxFreq, weight = 1.0) {
        this.initFreqBinCache();
        
        // find matching cached band or calculate bins
        let minBin, maxBin;
        for (const [bandName, cache] of Object.entries(this.freqBinCache)) {
            const band = this.freqBands[bandName];
            if (band.min === minFreq && band.max === maxFreq) {
                minBin = cache.minBin;
                maxBin = cache.maxBin;
                break;
            }
        }
        
        // fallback to calculation if not cached
        if (minBin === undefined) {
            minBin = Math.floor(minFreq * this.analyser.frequencyBinCount / this.sampleRate);
            maxBin = Math.floor(maxFreq * this.analyser.frequencyBinCount / this.sampleRate);
        }
        
        let energy = 0;
        const binRange = maxBin - minBin;
        
        for (let i = minBin; i < maxBin; i++) {
            energy += Math.pow(10, freqData[i] / 20);
        }
        
        return binRange > 0 ? (energy / binRange) * weight : 0;
    }
    
    // apply frequency skew weighting based on user setting
    getFrequencyWeight(freq) {
        const skew = this.params.frequencySkew;
        const centerFreq = 3500; // center of mouth click range
        const freqRatio = freq / centerFreq;
        
        if (skew < 0) {
            // bias toward lower frequencies
            return Math.exp(-Math.abs(skew) * Math.max(0, freqRatio - 1));
        } else if (skew > 0) {
            // bias toward higher frequencies  
            return Math.exp(-skew * Math.max(0, 1 - freqRatio));
        } else {
            // neutral - focus on mouth range
            const distance = Math.abs(freq - centerFreq) / centerFreq;
            return Math.exp(-2 * distance);
        }
    }

    // calculate dynamic loudness and adapt thresholds
    updateDynamicLoudness(timeData, freqData) {
        // calculate rms loudness with safety checks
        let rms = 0;
        for (let i = 0; i < timeData.length; i++) {
            if (isFinite(timeData[i])) {
                rms += timeData[i] * timeData[i];
            }
        }
        rms = Math.sqrt(rms / timeData.length);
        const loudnessDb = isFinite(rms) && rms > 0 ? 
            20 * Math.log10(Math.max(rms, 1e-10)) : -60;
        
        // update loudness history
        this.loudnessHistory.push(loudnessDb);
        if (this.loudnessHistory.length > 30) {
            this.loudnessHistory.shift();
        }
        
        // calculate background noise level (10th percentile)
        const sortedLoudness = [...this.loudnessHistory].sort((a, b) => a - b);
        this.backgroundNoiseLevel = sortedLoudness[Math.floor(sortedLoudness.length * 0.1)];
        
        // calculate signal-to-noise ratio with safety checks
        const currentSignal = isFinite(loudnessDb) ? loudnessDb : -60;
        const backgroundNoise = isFinite(this.backgroundNoiseLevel) ? this.backgroundNoiseLevel : -40;
        this.signalToNoiseRatio = Math.max(0.1, Math.min(60, currentSignal - backgroundNoise));
        
        // adaptive threshold based on loudness with safety bounds
        const loudnessBoost = Math.max(1.0, Math.min(5.0, 3.0 - (this.signalToNoiseRatio / 20))); // boost detection in quiet audio
        this.adaptiveThreshold = Math.max(0.1, Math.min(1.0, this.params.thresholds.confidenceThreshold / loudnessBoost));
        
        return { loudnessDb, snr: this.signalToNoiseRatio, adaptiveThreshold: this.adaptiveThreshold };
    }

    // rate limiting and click prioritization to prevent stuttering
    shouldProcessClick(isDetected, confidence) {
        if (!isDetected) return false;
        
        const currentTime = performance.now();
        
        // clean up old click history (keep only last 1 second)
        this.clickHistory = this.clickHistory.filter(time => currentTime - time < 1000);
        
        // check if we're in suppression period after recent processing
        if (currentTime < this.clickSuppressionTime) {
            return false;
        }
        
        // check rate limiting - max clicks per second
        if (this.clickHistory.length >= this.maxClicksPerSecond) {
            return false;
        }
        
        // check minimum interval between clicks
        if (currentTime - this.lastClickTime < this.minClickInterval) {
            return false;
        }
        
        // prioritize with sensitivity-adjusted confidence requirements
        const clickRatio = this.clickHistory.length / this.maxClicksPerSecond;
        const sensitivityBoost = Math.pow(this.params.sensitivity, 0.8); // moderate scaling for rate limiting
        const baseRequiredConfidence = 0.5 / sensitivityBoost; // lower requirements at higher sensitivity
        const requiredConfidence = baseRequiredConfidence + (clickRatio * 0.3 / sensitivityBoost);
        
        if (confidence < requiredConfidence) {
            return false;
        }
        
        // record this click
        this.clickHistory.push(currentTime);
        this.lastClickTime = currentTime;
        
        // set suppression period after processing to allow audio to settle
        this.clickSuppressionTime = currentTime + 50; // 50ms suppression after each click
        
        return true;
    }

    // balanced mouth click detection with enhanced quality
    detectMouthClick(timeData, freqData) {
        if (!this.processingEnabled) {
            return { 
                isClick: false, 
                confidence: 0, 
                lpcConfidence: 0, 
                spectralConfidence: 0,
                details: {} 
            };
        }

        // dynamic loudness adaptation
        const loudnessInfo = this.updateDynamicLoudness(timeData, freqData);
        
        // update circular buffer for lpc analysis
        for (let i = 0; i < timeData.length; i++) {
            this.circularBuffer[this.bufferIndex] = timeData[i];
            this.bufferIndex = (this.bufferIndex + 1) % this.bufferSize;
        }

        // 1. high-quality lpc analysis with larger window
        const windowSize = Math.min(1024, timeData.length); // larger analysis window
        const analysisWindow = timeData.slice(-windowSize);
        
        const lpcResult = this.computeLPCCoefficients(analysisWindow, this.lpcOrder);
        const predictionError = this.computePredictionError(analysisWindow, lpcResult.coefficients);
        
        // calculate rms and peak of prediction error
        let errorRMS = 0;
        let errorPeak = 0;
        for (let i = this.lpcOrder; i < predictionError.length; i++) {
            const absError = Math.abs(predictionError[i]);
            errorRMS += predictionError[i] * predictionError[i];
            errorPeak = Math.max(errorPeak, absError);
        }
        errorRMS = Math.sqrt(errorRMS / (predictionError.length - this.lpcOrder));
        
        // adaptive error threshold with expanded sensitivity range
        const sensitivityMultiplier = Math.pow(this.params.sensitivity, 2.5); // exponential scaling for bigger range
        const baseErrorThreshold = this.params.thresholds.lpcError / sensitivityMultiplier; // inverse relationship
        const adaptiveErrorThreshold = baseErrorThreshold / Math.max(1.0, loudnessInfo.snr / 10);
        
        // multiple lpc-based detections
        const lpcRmsConfidence = Math.min(2.0, errorRMS / adaptiveErrorThreshold);
        const lpcPeakConfidence = Math.min(2.0, errorPeak / (adaptiveErrorThreshold * 3));
        const lpcConfidence = Math.max(lpcRmsConfidence, lpcPeakConfidence);

        // 2. multi-band spectral analysis with frequency weighting
        const bandEnergies = {
            low: this.calculateBandEnergy(freqData, this.freqBands.low.min, this.freqBands.low.max, this.params.freqWeights.low),
            mid: this.calculateBandEnergy(freqData, this.freqBands.mid.min, this.freqBands.mid.max, this.params.freqWeights.mid),
            high: this.calculateBandEnergy(freqData, this.freqBands.high.min, this.freqBands.high.max, this.params.freqWeights.high),
            mouth: this.calculateBandEnergy(freqData, this.freqBands.mouth.min, this.freqBands.mouth.max, this.params.freqWeights.mouth)
        };

        // 3. spectral flux analysis (sudden spectral changes)
        let spectralFlux = 0;
        if (this.previousSpectrum.length > 0) {
            for (let i = 0; i < freqData.length; i++) {
                const diff = freqData[i] - this.previousSpectrum[i];
                spectralFlux += Math.max(0, diff); // only positive changes
            }
            spectralFlux /= freqData.length;
        }
        this.previousSpectrum.set(freqData);

        // 4. transient detection with exponential sensitivity scaling
        const totalEnergy = bandEnergies.low + bandEnergies.mid + bandEnergies.high + 0.0001;
        const mouthBandRatio = bandEnergies.mouth / totalEnergy;
        const transientSensitivity = Math.pow(this.params.sensitivity, 2.0); // exponential scaling
        const adaptiveTransientThreshold = this.params.thresholds.transientRatio / transientSensitivity / Math.max(1.0, loudnessInfo.snr / 15);
        const transientDetected = mouthBandRatio > adaptiveTransientThreshold;

        // 5. multiple spectral shape analyses
        const spectralCentroid = this.calculateSpectralCentroid(freqData);
        const spectralSpread = this.calculateSpectralSpread(freqData, spectralCentroid);
        const broadbandRatio = spectralSpread / (spectralCentroid + 1);
        
        // 6. high frequency burst detection with sensitivity scaling
        const highFreqBurst = bandEnergies.high / (bandEnergies.low + bandEnergies.mid + 0.0001);
        const burstSensitivity = Math.pow(this.params.sensitivity, 1.8); // exponential scaling
        const burstDetected = highFreqBurst > (2.0 / burstSensitivity / Math.max(1.0, loudnessInfo.snr / 10));
        
        // 7. amplitude spike detection with sensitivity scaling
        let maxAmplitude = 0;
        for (let i = 0; i < timeData.length; i++) {
            maxAmplitude = Math.max(maxAmplitude, Math.abs(timeData[i]));
        }
        const amplitudeSensitivity = Math.pow(this.params.sensitivity, 2.3); // strong exponential scaling
        const amplitudeSpike = maxAmplitude > (0.1 / amplitudeSensitivity / Math.max(1.0, loudnessInfo.snr / 20));

        // 8. apply frequency skew weighting
        const skewWeight = this.getFrequencyWeight(spectralCentroid);
        
        // multi-method detection with exponentially scaled sensitivity
        const spectralSensitivity = Math.pow(this.params.sensitivity, 2.2); // exponential scaling
        const adaptiveSpectralThreshold = this.params.thresholds.spectralFlux / spectralSensitivity / Math.max(1.0, loudnessInfo.snr / 8);
        
        const detectionMethods = {
            lpcOutlier: {
                confidence: lpcConfidence,
                weight: 0.35,
                detected: lpcConfidence > 0.4 // much lower threshold
            },
            spectralFlux: {
                confidence: Math.min(2.0, spectralFlux / adaptiveSpectralThreshold),
                weight: 0.25,
                detected: spectralFlux > adaptiveSpectralThreshold
            },
            mouthBandTransient: {
                confidence: Math.min(2.0, mouthBandRatio / adaptiveTransientThreshold),
                weight: 0.2,
                detected: transientDetected
            },
            highFreqBurst: {
                confidence: Math.min(2.0, highFreqBurst / 2.0),
                weight: 0.15,
                detected: burstDetected
            },
            amplitudeSpike: {
                confidence: amplitudeSpike ? 1.5 : 0,
                weight: 0.05,
                detected: amplitudeSpike
            }
        };

        // calculate weighted confidence with frequency skew
        let totalWeight = 0;
        let weightedConfidence = 0;
        
        Object.values(detectionMethods).forEach(method => {
            const adjustedWeight = method.weight * skewWeight;
            totalWeight += adjustedWeight;
            weightedConfidence += method.confidence * adjustedWeight;
        });
        
        const finalConfidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;
        
        // balanced speech protection for quality detection
        const speechProtection = this.checkSpeechProtection(timeData, freqData, bandEnergies) * 0.6; // moderate protection
        const adjustedConfidence = finalConfidence * (1 - speechProtection);
        
        // exponentially scaled confidence threshold
        const confidenceSensitivity = Math.pow(this.params.sensitivity, 1.5); // moderate exponential scaling
        const scaledConfidenceThreshold = this.params.thresholds.confidenceThreshold / confidenceSensitivity;
        const dynamicThreshold = Math.min(this.adaptiveThreshold, scaledConfidenceThreshold);
        
        const isClickDetected = adjustedConfidence > dynamicThreshold || 
                               (lpcConfidence > (1.5 / confidenceSensitivity) && spectralFlux > adaptiveSpectralThreshold) || 
                               (amplitudeSpike && mouthBandRatio > (0.5 / Math.sqrt(confidenceSensitivity)) && lpcConfidence > (1.0 / confidenceSensitivity));
        
        // rate limiting and click prioritization
        const shouldProcessClick = this.shouldProcessClick(isClickDetected, adjustedConfidence);
        
        if (shouldProcessClick) {
            this.handleMouthClickDetected(adjustedConfidence);
        }

        return {
            isClick: shouldProcessClick,
            confidence: adjustedConfidence,
            lpcConfidence,
            spectralConfidence: finalConfidence,
            details: {
                errorRMS,
                errorPeak,
                spectralFlux,
                mouthBandRatio,
                spectralCentroid,
                broadbandRatio,
                highFreqBurst,
                amplitudeSpike,
                maxAmplitude,
                skewWeight,
                speechProtection,
                bandEnergies,
                loudnessInfo,
                dynamicThreshold,
                adaptiveSpectralThreshold,
                adaptiveTransientThreshold
            }
        };
    }

    // calculate spectral centroid (brightness measure)
    calculateSpectralCentroid(freqData) {
        let numerator = 0;
        let denominator = 0;
        
        for (let i = 0; i < freqData.length; i++) {
            const freq = (i * this.sampleRate) / (2 * freqData.length);
            const magnitude = Math.pow(10, freqData[i] / 20);
            numerator += freq * magnitude;
            denominator += magnitude;
        }
        
        return denominator > 0 ? numerator / denominator : 0;
    }

    // calculate spectral spread (measure of frequency distribution)
    calculateSpectralSpread(freqData, centroid) {
        let numerator = 0;
        let denominator = 0;
        
        for (let i = 0; i < freqData.length; i++) {
            const freq = (i * this.sampleRate) / (2 * freqData.length);
            const magnitude = Math.pow(10, freqData[i] / 20);
            numerator += Math.pow(freq - centroid, 2) * magnitude;
            denominator += magnitude;
        }
        
        return denominator > 0 ? Math.sqrt(numerator / denominator) : 0;
    }

    // speech protection to avoid removing consonants and plosives
    checkSpeechProtection(timeData, freqData, bandEnergies) {
        // check for periodic structure (speech has more periodicity than clicks)
        const autocorr = this.calculateAutocorrelation(timeData, 50);
        const periodicity = Math.max(...autocorr.slice(10)); // skip first few samples
        
        // check for formant structure (speech has clear formants)
        const formantStrength = this.detectFormantStructure(freqData);
        
        // check for sustained energy (speech lasts longer than clicks)
        const sustainedEnergy = bandEnergies.low + bandEnergies.mid > bandEnergies.high;
        
        // combine protection factors
        const protectionFactors = [
            periodicity > 0.3 ? 0.8 : 0,      // strong periodicity = likely speech
            formantStrength > 0.4 ? 0.6 : 0,  // clear formants = likely speech
            sustainedEnergy ? 0.3 : 0          // sustained low/mid energy = likely speech
        ];
        
        return Math.max(...protectionFactors);
    }

    // calculate autocorrelation for periodicity detection
    calculateAutocorrelation(signal, maxLag) {
        const result = new Array(maxLag).fill(0);
        const n = signal.length;
        
        for (let lag = 0; lag < maxLag && lag < n; lag++) {
            for (let i = 0; i < n - lag; i++) {
                result[lag] += signal[i] * signal[i + lag];
            }
            result[lag] /= (n - lag);
        }
        
        return result;
    }

    // detect formant structure in spectrum
    detectFormantStructure(freqData) {
        // look for peaks in speech formant regions (roughly 500-3000 hz)
        const formantStart = Math.floor(500 * freqData.length * 2 / this.sampleRate);
        const formantEnd = Math.floor(3000 * freqData.length * 2 / this.sampleRate);
        
        let peakCount = 0;
        let prevValue = freqData[formantStart];
        let isRising = false;
        
        for (let i = formantStart + 1; i < formantEnd; i++) {
            if (freqData[i] > prevValue && !isRising) {
                isRising = true;
            } else if (freqData[i] < prevValue && isRising) {
                peakCount++;
                isRising = false;
            }
            prevValue = freqData[i];
        }
        
        // normalize peak count (speech typically has 2-4 formants)
        return Math.min(1.0, peakCount / 4);
    }

    // advanced click repair using professional-grade interpolation
    handleMouthClickDetected(confidence) {
        const currentTime = this.audioContext.currentTime;
        const lookAheadTime = currentTime + this.delayNode.delayTime.value;
        
        // calculate click widening duration based on mode and user setting
        const baseWidening = this.params.clickWidening / 1000; // convert ms to seconds
        const modeMultiplier = this.params.mode === 'smack' ? 1.5 : 1.0;
        const wideningDuration = baseWidening * modeMultiplier;
        
        // calculate reduction amount with safety checks
        let reductionFactor = this.params.reductionAmount <= -60 ? 
            0.0001 : // complete removal
            Math.pow(10, this.params.reductionAmount / 20); // partial reduction
        
        // safety checks to prevent non-finite values
        if (!isFinite(reductionFactor) || reductionFactor <= 0) {
            reductionFactor = 0.0001;
        }
        if (!isFinite(confidence) || confidence < 0) {
            confidence = 0.5;
        }
        if (!isFinite(wideningDuration) || wideningDuration <= 0) {
            wideningDuration = 0.005; // 5ms fallback
        }
        
        // apply smooth, gentle gain changes to prevent stuttering
        try {
            this.clickGain.gain.cancelScheduledValues(lookAheadTime - wideningDuration * 2);
            
            // much gentler, longer transitions to avoid stuttering
            const fadeInTime = Math.max(0.01, wideningDuration * 0.5); // longer fade in
            const fadeOutTime = Math.max(0.02, wideningDuration * 1.5); // much longer fade out
            
            // gentle pre-fade
            this.clickGain.gain.setValueAtTime(1.0, lookAheadTime - fadeInTime);
            this.clickGain.gain.linearRampToValueAtTime(Math.max(0.1, reductionFactor), lookAheadTime);
            
            // hold reduced level during click (less aggressive reduction)
            this.clickGain.gain.setValueAtTime(Math.max(0.1, reductionFactor), lookAheadTime + wideningDuration);
            
            // very smooth restoration to prevent audio artifacts
            this.clickGain.gain.linearRampToValueAtTime(0.6, lookAheadTime + wideningDuration + fadeOutTime * 0.3);
            this.clickGain.gain.linearRampToValueAtTime(0.85, lookAheadTime + wideningDuration + fadeOutTime * 0.7);
            this.clickGain.gain.linearRampToValueAtTime(1.0, lookAheadTime + wideningDuration + fadeOutTime);
            
        } catch (error) {
            // ultra-simple fallback for maximum stability
            handleError(error, 'smooth gain ramp');
            this.clickGain.gain.cancelScheduledValues(lookAheadTime);
            this.clickGain.gain.setValueAtTime(0.3, lookAheadTime); // gentle reduction only
            this.clickGain.gain.linearRampToValueAtTime(1.0, lookAheadTime + 0.05); // quick recovery
        }

        this.clickCount++;
        
        // log for debugging
        if (DEBUG) {
            log(`Click detected: confidence=${confidence.toFixed(2)}, widening=${wideningDuration*1000}ms, reduction=${this.params.reductionAmount}dB`);
        }
    }
    
    // interpolate audio segment for seamless click repair (future enhancement)
    interpolateAudioSegment(startIdx, endIdx, buffer) {
        // this would implement sophisticated interpolation like autoregressive modeling
        // for now, we use the gain-based approach which is simpler and still effective
        const segmentLength = endIdx - startIdx;
        const preContext = buffer.slice(Math.max(0, startIdx - segmentLength), startIdx);
        const postContext = buffer.slice(endIdx, Math.min(buffer.length, endIdx + segmentLength));
        
        // simple linear interpolation between contexts
        const interpolated = new Float32Array(segmentLength);
        for (let i = 0; i < segmentLength; i++) {
            const ratio = i / segmentLength;
            const preValue = preContext.length > 0 ? preContext[preContext.length - 1] : 0;
            const postValue = postContext.length > 0 ? postContext[0] : 0;
            interpolated[i] = preValue * (1 - ratio) + postValue * ratio;
        }
        
        return interpolated;
    }

    // optimized real-time analysis with frame skipping for performance
    analyzeAudio() {
        // safety check: ensure audio context is running
        if (!this.audioContext || this.audioContext.state !== 'running' || !this.analyser) {
            return null;
        }
        
        const currentTime = performance.now();
        
        // frame-based processing to reduce cpu load
        this.frameCounter++;
        if (this.frameCounter % this.processingInterval !== 0) {
            return null; // skip processing this frame
        }
        
        // rate limiting for performance
        if (currentTime - this.lastProcessingTime < (1000 / this.targetProcessingRate)) {
            return null;
        }
        this.lastProcessingTime = currentTime;

        try {
            // get current audio data with error handling
            this.analyser.getFloatTimeDomainData(this.timeData);
            this.analyser.getFloatFrequencyData(this.freqData);

            // perform advanced mouth click detection
            const result = this.detectMouthClick(this.timeData, this.freqData);
            
            // update debug display if enabled (less frequently)
            if (this.debugEnabled && this.debugElement && this.frameCounter % 6 === 0 && result) {
                this.updateAdvancedDebugDisplay(result);
            }
            
            return result;
        } catch (error) {
            handleError(error, 'analyzeAudio');
            return null;
        }
    }

    // advanced debug display with detailed analysis metrics
    updateAdvancedDebugDisplay(detection) {
        if (!this.debugEnabled || !this.debugElement) return;

        const confidence = (detection.confidence * 100).toFixed(1);
        const lpcConf = (detection.lpcConfidence * 100).toFixed(1);
        const spectralConf = (detection.spectralConfidence * 100).toFixed(1);
        
        const confidenceColor = confidence > 70 ? '#ff4444' :
            confidence > 40 ? '#ffaa44' : '#44ff44';
            
        const details = detection.details || {};
        const centroid = (details.spectralCentroid && isFinite(details.spectralCentroid)) ? 
            (details.spectralCentroid / 1000).toFixed(1) : '0.0';
        const mouthRatio = (details.mouthBandRatio && isFinite(details.mouthBandRatio)) ? 
            (details.mouthBandRatio * 100).toFixed(0) : '0';
        const speechProt = (details.speechProtection && isFinite(details.speechProtection)) ? 
            (details.speechProtection * 100).toFixed(0) : '0';
        const snr = (details.loudnessInfo && details.loudnessInfo.snr && isFinite(details.loudnessInfo.snr)) ? 
            details.loudnessInfo.snr.toFixed(1) : '0';
        const dynThresh = (details.dynamicThreshold && isFinite(details.dynamicThreshold)) ? 
            (details.dynamicThreshold * 100).toFixed(0) : '35';
        const ampSpike = details.amplitudeSpike ? '🔴' : '⚫';
        const hfBurst = (details.highFreqBurst && isFinite(details.highFreqBurst)) ? 
            (details.highFreqBurst * 100).toFixed(0) : '0';
        
        // rate limiting info
        const clicksThisSecond = this.clickHistory.length;
        const rateLimitColor = clicksThisSecond >= this.maxClicksPerSecond * 0.8 ? '#ff6666' : '#66ff66';

        this.debugElement.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.3);">
                <div style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 12px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 8px;">
                    debug
                </div>
                <div style="font-size: 10px; opacity: 0.8;">
                    v${this.params.mode}
                </div>
            </div>
            
            <div style="background: rgba(255,255,255,0.1); border-radius: 4px; padding: 6px; margin-bottom: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                    <span style="font-size: 10px; opacity: 0.8;">confidence</span>
                    <span style="color: ${confidenceColor}; font-weight: bold; font-size: 12px;">${confidence}%</span>
                </div>
                <div style="display: flex; gap: 8px; font-size: 9px; opacity: 0.9;">
                    <span>lpc: ${lpcConf}%</span>
                    <span>spec: ${spectralConf}%</span>
                    <span>snr: ${snr}db</span>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 9px; margin-bottom: 6px;">
                <div style="background: rgba(255,255,255,0.08); padding: 3px 5px; border-radius: 3px;">
                    <div style="opacity: 0.7;">rate limit</div>
                    <div style="color: ${rateLimitColor}; font-weight: bold;">${clicksThisSecond}/${this.maxClicksPerSecond}</div>
                </div>
                <div style="background: rgba(255,255,255,0.08); padding: 3px 5px; border-radius: 3px;">
                    <div style="opacity: 0.7;">mouth ratio</div>
                    <div style="font-weight: bold;">${mouthRatio}%</div>
                </div>
                <div style="background: rgba(255,255,255,0.08); padding: 3px 5px; border-radius: 3px;">
                    <div style="opacity: 0.7;">hf burst</div>
                    <div style="font-weight: bold;">${hfBurst}%</div>
                </div>
                <div style="background: rgba(255,255,255,0.08); padding: 3px 5px; border-radius: 3px;">
                    <div style="opacity: 0.7;">speech prot</div>
                    <div style="font-weight: bold;">${speechProt}%</div>
                </div>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.1); padding: 4px 6px; border-radius: 4px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-size: 12px;">${ampSpike}</span>
                    <span style="color: ${detection.isClick ? '#FFD700' : 'rgba(255,255,255,0.8)'}; font-size: 10px; font-weight: 500;">
                        ${detection.isClick ? 'PROCESSING' : 'monitoring'}
                    </span>
                </div>
                <div style="font-size: 10px; opacity: 0.9;">
                    clicks: ${this.clickCount}
                </div>
            </div>
        `;
    }

    // Connect audio source to processor
    processAudio(sourceNode) {
        sourceNode.disconnect();
        sourceNode.connect(this.inputGain);
    }

    // start continuous advanced mouth click detection
    startDetection() {
        const detect = () => {
            this.analyzeAudio();
            requestAnimationFrame(detect);
        };
        detect();
    }
    
    // update processing parameters
    updateParameters(newParams) {
        Object.assign(this.params, newParams);
        if (DEBUG) {
            log('Parameters updated:', newParams);
        }
    }
    
    // set sensitivity (0.1 to 2.0)
    setSensitivity(sensitivity) {
        this.params.sensitivity = Math.max(0.1, Math.min(2.0, sensitivity));
    }
    
    // set frequency skew (-1.0 to 1.0)
    setFrequencySkew(skew) {
        this.params.frequencySkew = Math.max(-1.0, Math.min(1.0, skew));
    }
    
    // set click widening (1-20ms)
    setClickWidening(widening) {
        this.params.clickWidening = Math.max(1, Math.min(20, widening));
    }
    
    // set reduction amount (-60 to 0 db)
    setReductionAmount(reduction) {
        this.params.reductionAmount = Math.max(-60, Math.min(0, reduction));
    }
    
    // set processing mode
    setMode(mode) {
        if (mode === 'click' || mode === 'smack') {
            this.params.mode = mode;
            // adjust parameters for mode
            if (mode === 'smack') {
                // smack mode: longer widening, lower frequency focus
                this.params.clickWidening = Math.max(this.params.clickWidening, 8);
                this.params.frequencySkew = Math.max(-0.3, this.params.frequencySkew - 0.2);
            }
        }
    }

    // Create debug overlay
    createDebugDisplay() {
        const existingDisplay = document.getElementById('click-debug');
        if (existingDisplay) {
            existingDisplay.remove();
        }

        const display = document.createElement('div');
        display.id = 'click-debug';
        display.style.cssText = `
            position: fixed;
            bottom: 15px;
            right: 15px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px;
            border-radius: 8px;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 11px;
            z-index: 9999;
            width: 200px;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            border: 1px solid rgba(255, 255, 255, 0.2);
        `;
        document.body.appendChild(display);
        this.debugElement = display;
        return display;
    }

    // Toggle debug display
    toggleDebug(enabled) {
        this.debugEnabled = enabled;
        if (enabled) {
            if (!this.debugElement) {
                this.createDebugDisplay();
            }
            this.debugElement.style.display = 'block';
        } else if (this.debugElement) {
            this.debugElement.remove();
            this.debugElement = null;
        }
    }

    // Toggle click removal processing
    toggleProcessing(enabled, isGlobal = false) {
        this.processingEnabled = enabled;

        chrome.storage.sync.get(['siteSettings'], (data) => {
            if (isGlobal) {
                chrome.storage.sync.set({ globalProcessingEnabled: enabled });
            } else {
                const siteSettings = data.siteSettings || {};
                siteSettings[this.hostname] = enabled;
                chrome.storage.sync.set({ siteSettings: siteSettings });
            }
        });

        if (!enabled) {
            this.clickGain.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.clickGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        }
    }

    smoothValue(oldValue, newValue, smoothingFactor) {
        return oldValue * smoothingFactor + newValue * (1 - smoothingFactor);
    }
}

// main audio processor controller with advanced mouth de-click
const AudioProcessor = {
    context: null,
    mouthDeClicker: null,
    activeConnections: new Map(),

    init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        document.addEventListener('click', () => this.ensureAudioContext(), { once: true });
        document.addEventListener('touchstart', () => this.ensureAudioContext(), { once: true });
        document.addEventListener('keydown', () => this.ensureAudioContext(), { once: true });
        document.addEventListener('play', (event) => {
            if (event.target.tagName === 'VIDEO') {
                this.handleVideo(event.target);
            }
        }, true);
    },

    ensureAudioContext() {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.context.state === 'suspended') {
            this.context.resume();
        }
    },

    handleVideo(video) {
        this.ensureAudioContext();

        if (this.context.state === 'running' && !this.activeConnections.has(video)) {
            try {
                const source = this.context.createMediaElementSource(video);
                this.activeConnections.set(video, source);

                if (!this.mouthDeClicker) {
                    this.mouthDeClicker = new AdvancedMouthDeClicker(this.context);
                }

                this.mouthDeClicker.processAudio(source);
                this.mouthDeClicker.startDetection();
            } catch (error) {
                handleError(error, 'handleVideo');
            }
        }
    }
};

// handle messages from popup with advanced controls
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        if (!AudioProcessor.mouthDeClicker) return;

        switch (message.type) {
            case 'toggleProcessing':
                AudioProcessor.mouthDeClicker.toggleProcessing(message.value);
                break;
            case 'toggleDebug':
                AudioProcessor.mouthDeClicker.toggleDebug(message.value);
                break;
            case 'updateSensitivity':
                AudioProcessor.mouthDeClicker.setSensitivity(message.value);
                break;
            case 'updateFrequencySkew':
                AudioProcessor.mouthDeClicker.setFrequencySkew(message.value);
                break;
            case 'updateClickWidening':
                AudioProcessor.mouthDeClicker.setClickWidening(message.value);
                break;
            case 'updateReductionAmount':
                AudioProcessor.mouthDeClicker.setReductionAmount(message.value);
                break;
            case 'updateMode':
                AudioProcessor.mouthDeClicker.setMode(message.value);
                break;
        }
    } catch (error) {
        handleError(error, 'message listener');
    }
});

// Initialize processor
AudioProcessor.init();