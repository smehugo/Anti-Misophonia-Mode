# Advanced Mouth De-Click Pro

A professional-grade Chrome extension that eliminates mouth clicks, lip smacks, and saliva sounds from video audio using advanced audio processing algorithms. Perfect for users with misophonia or anyone seeking crystal-clear audio quality.

## Features

### Core Capabilities
- **Advanced Mouth Click Detection**: Uses Linear Prediction Coding (LPC) for precise outlier detection
- **Multi-Band Frequency Analysis**: Targets mouth clicks in the 2-5kHz range with surgical precision
- **Speech Protection**: Intelligent algorithms avoid removing consonants and plosives
- **Real-Time Processing**: ~120ms latency with enhanced buffering system for superior quality

### Professional Controls
- **Detection Modes**: 
  - **Click Mode**: For sharp, brief transients (lip ticks, saliva clicks)
  - **Smack Mode**: For longer, wet mouth sounds (lip smacks, mouth opening sounds)
- **Sensitivity Control**: Adjustable from 0.1x to 2.0x for different audio conditions
- **Frequency Focus**: Skew detection from low frequencies to high frequencies or focus on mouth range
- **Click Widening**: 1-20ms duration control to capture full mouth sound events
- **Reduction Amount**: Choose complete removal or partial attenuation (-60dB to 0dB)

### Advanced Features
- **Spectral Flux Analysis**: Detects sudden spectral changes characteristic of mouth clicks
- **Formant Structure Detection**: Protects speech by recognizing vocal tract resonances
- **Adaptive Thresholding**: Automatically adjusts to audio characteristics
- **Performance Optimized**: Frame-based processing with CPU load management

## Installation

1. Clone or download the repository.
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the downloaded folder.
5. Misophonia Mode will now be available in your Chrome extensions.

## Permissions

- **activeTab**: Allows the extension to interact with the active tab for real-time audio processing.
- **storage**: Saves user preferences such as sensitivity and debug settings.

## Usage & Controls

### Basic Setup
1. Navigate to any video page (YouTube, Netflix, Coursera, etc.)
2. Click the extension icon to open the sleek control panel
3. Toggle **Enabled** to activate mouth click processing
4. Audio processing begins automatically when video plays

### Core Controls

#### **Enabled Toggle**
- **ON**: Activates real-time mouth click removal
- **OFF**: Passes audio through unchanged
- Works instantly - no page refresh needed

#### **Debug Toggle**  
- **ON**: Shows beautiful debug overlay with real-time metrics
- **OFF**: Clean audio processing without visual feedback
- Debug window matches extension styling with gradient background

#### **Detection Mode**
- **Click Mode**: Optimized for sharp, brief transients (lip ticks, saliva clicks)
- **Smack Mode**: Tuned for longer, wet mouth sounds (lip smacks, mouth opening sounds)
- Automatically adjusts processing parameters for each type

### Advanced Settings

#### **Sensitivity** (0.1 - 2.0)
- **Exponentially scaled** for maximum control range
- **0.1-0.5**: Ultra-conservative (only obvious clicks)
- **0.6-0.8**: Conservative (default range)  
- **0.9-1.2**: Moderate (catches most clicks)
- **1.3-1.6**: Aggressive (catches subtle clicks)
- **1.7-2.0**: Maximum (catches everything possible)
- *Small slider movements = huge detection changes*

#### **Frequency Focus** (-1.0 to 1.0)
- **"low freq" (-1.0)**: Focus on deeper, bass-heavy mouth sounds
- **"low-mid" (-0.5)**: Balanced toward lower frequencies  
- **"mouth" (0.0)**: Optimized for typical mouth click range (2-5kHz)
- **"mid-high" (0.5)**: Balanced toward higher frequencies
- **"high freq" (1.0)**: Focus on sharp, bright clicks and ticks

#### **Widening** (1-20ms)
- Controls how much audio around each detected click gets processed
- **1-3ms**: Very precise, only the click peak
- **4-6ms**: Balanced (default 5ms)
- **7-12ms**: Wider processing for clicks with tails
- **13-20ms**: Maximum coverage for complex mouth sounds
- *Smack mode automatically increases widening*

#### **Reduction**
- **"complete"**: Full click removal (default)
- **"-12dB" to "-6dB"**: Partial reduction for transparency
- **"-3dB"**: Subtle reduction, preserves naturalness
- **"0dB"**: No reduction (bypass)

### Smart Features

#### **Rate Limiting** (Max 8 clicks/second)
- Prevents audio stuttering from over-processing
- Prioritizes high-confidence clicks when approaching limit
- 125ms minimum interval between processed clicks
- Debug shows current rate: "3/8" = using 3 of 8 slots

#### **Speech Protection**
- AI-powered detection of consonants and plosives
- Prevents removal of legitimate speech sounds
- Uses formant analysis and periodicity detection
- Automatically reduces when speech is detected

#### **Dynamic Adaptation**
- Adjusts sensitivity based on background noise levels
- Quieter audio = more sensitive detection
- Signal-to-noise ratio analysis in real-time
- Adaptive thresholds prevent false positives

### Debug Window Explained

When debug mode is enabled, you'll see a beautiful overlay showing:

- **Confidence**: Overall click detection confidence
- **LPC/Spec/SNR**: Technical analysis metrics  
- **Rate Limit**: Current usage vs maximum (3/8)
- **Mouth Ratio**: Energy in mouth frequency band
- **HF Burst**: High-frequency content analysis
- **Speech Prot**: Speech protection activation level
- **Status**: PROCESSING (removing click) or monitoring

### Recommended Settings

#### **Podcasts & Interviews**
- Sensitivity: 1.0-1.2, Click mode, Mouth focus, 5ms widening

#### **ASMR & Quiet Content**  
- Sensitivity: 1.3-1.8, Smack mode, Mouth focus, 8-12ms widening

#### **Music & Mixed Content**
- Sensitivity: 0.6-0.9, Click mode, Mid-high focus, -6dB reduction

#### **Noisy Environments**
- Sensitivity: 0.8-1.1, Click mode, High freq focus, Complete reduction

#### **Testing New Content**
- Enable debug mode first, adjust sensitivity until rate limit shows 2-6 clicks/second

## Technical Details

### Algorithm Overview
The extension implements a sophisticated multi-stage detection and repair system:

1. **Linear Prediction Coding (LPC)**: Analyzes audio predictability to identify sudden transients
2. **Multi-Band Spectral Analysis**: Separates frequency bands with targeted weighting
3. **Spectral Flux Detection**: Identifies rapid spectral changes characteristic of clicks
4. **Speech Protection**: Uses formant analysis and periodicity detection to preserve speech
5. **Adaptive Repair**: Applies gain scheduling with configurable reduction amounts

### Performance Characteristics
- **Latency**: ~120ms (enhanced buffer for better audio quality)
- **CPU Usage**: Frame-based processing with automatic load balancing
- **Memory**: Efficient circular buffering with cached frequency bin calculations
- **Compatibility**: Works with all HTML5 video elements

## Privacy

Advanced Mouth De-Click Pro is completely privacy-focused:
- **100% Local Processing**: All audio analysis happens on your device
- **No Data Collection**: Zero telemetry or usage tracking
- **No Network Requests**: Extension works entirely offline
- **No Audio Storage**: Audio is processed in real-time and immediately discarded

## Contributing

This project implements cutting-edge audio processing techniques. Contributions welcome for:
- Algorithm improvements and optimizations
- UI/UX enhancements
- Additional audio processing modes
- Performance optimizations
- Bug fixes and compatibility improvements

## License

MIT License - Feel free to use, modify, and distribute as needed.
