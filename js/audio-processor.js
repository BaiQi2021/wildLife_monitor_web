/**
 * 音频处理模块
 * 负责音频录制、处理和特征提取
 */
class AudioProcessor {
    constructor(visualizer) {
        this.audioContext = null;
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
        this.analyser = null;
        this.visualizer = visualizer;
        this.recordingInterval = null;
        this.recordingStartTime = null;
        this.recordingDuration = 3000; // 默认录制3秒
        this.recordingCallback = null;
    }

    /**
     * 初始化音频处理器
     */
    async initialize() {
        try {
            // 创建音频上下文
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 重置所有状态
            this.stopRecording();
            
            return true;
        } catch (error) {
            console.error('音频处理器初始化失败:', error);
            return false;
        }
    }

    /**
     * 请求麦克风权限并开始捕获
     */
    async requestMicrophoneAccess() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            // 连接音频分析器用于可视化
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            source.connect(this.analyser);
            
            // 初始化可视化器
            if (this.visualizer) {
                this.visualizer.setAnalyser(this.analyser);
                this.visualizer.startVisualization();
            }
            
            return true;
        } catch (error) {
            console.error('获取麦克风权限失败:', error);
            return false;
        }
    }

    /**
     * 开始录制音频
     * @param {Function} callback - 录制完成后的回调函数
     */
    startRecording(callback) {
        if (this.isRecording || !this.mediaStream) return false;
        
        this.recordingCallback = callback;
        this.audioChunks = [];
        
        // 创建MediaRecorder
        this.mediaRecorder = new MediaRecorder(this.mediaStream);
        
        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.audioChunks.push(event.data);
            }
        };
        
        this.mediaRecorder.onstop = () => {
            // 创建音频Blob并执行回调
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
            if (this.recordingCallback) {
                this.recordingCallback(audioBlob);
            }
        };
        
        // 开始录制
        this.mediaRecorder.start();
        this.isRecording = true;
        this.recordingStartTime = Date.now();
        
        // 设置定时器自动停止录制
        this.recordingInterval = setTimeout(() => {
            this.stopRecording();
        }, this.recordingDuration);
        
        return true;
    }

    /**
     * 停止录制音频
     */
    stopRecording() {
        if (this.recordingInterval) {
            clearTimeout(this.recordingInterval);
            this.recordingInterval = null;
        }
        
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            return true;
        }
        
        return false;
    }

    /**
     * 释放资源
     */
    releaseResources() {
        this.stopRecording();
        
        if (this.visualizer) {
            this.visualizer.stopVisualization();
        }
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        this.analyser = null;
        
        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
        }
    }

    /**
     * 从Blob加载音频文件
     * @param {Blob} audioBlob - 音频Blob对象
     * @returns {Promise<AudioBuffer>} - 音频缓冲区
     */
    async loadAudioFile(audioBlob) {
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            
            fileReader.onload = async (event) => {
                try {
                    // 确保AudioContext已初始化
                    if (!this.audioContext) {
                        await this.initialize();
                    }
                    
                    // 解码音频数据
                    const audioBuffer = await this.audioContext.decodeAudioData(event.target.result);
                    resolve(audioBuffer);
                } catch (error) {
                    console.error('音频解码失败:', error);
                    reject(error);
                }
            };
            
            fileReader.onerror = reject;
            fileReader.readAsArrayBuffer(audioBlob);
        });
    }

    /**
     * 重采样音频到指定采样率
     * @param {AudioBuffer} audioBuffer - 原始音频缓冲区
     * @param {number} targetSampleRate - 目标采样率
     * @returns {Float32Array} - 重采样后的音频数据
     */
    resampleAudio(audioBuffer, targetSampleRate = 16000) {
        const originalSampleRate = audioBuffer.sampleRate;
        const originalLength = audioBuffer.length;
        const channels = audioBuffer.numberOfChannels;
        
        // 如果已经是目标采样率，直接返回原始数据
        if (originalSampleRate === targetSampleRate) {
            // 如果是多声道，取第一个声道
            return audioBuffer.getChannelData(0);
        }
        
        // 计算新的长度
        const targetLength = Math.round(originalLength * targetSampleRate / originalSampleRate);
        const result = new Float32Array(targetLength);
        
        // 获取第一个声道数据
        const channelData = audioBuffer.getChannelData(0);
        
        // 线性插值重采样
        const stepSize = originalSampleRate / targetSampleRate;
        for (let i = 0; i < targetLength; i++) {
            const position = i * stepSize;
            const index = Math.floor(position);
            const fraction = position - index;
            
            if (index >= originalLength - 1) {
                result[i] = channelData[originalLength - 1];
            } else {
                result[i] = channelData[index] * (1 - fraction) + channelData[index + 1] * fraction;
            }
        }
        
        return result;
    }

    /**
     * 标准化音频长度
     * @param {Float32Array} audio - 音频数据
     * @param {number} sampleRate - 采样率
     * @param {number} targetDuration - 目标时长（秒）
     * @returns {Float32Array} - 标准化后的音频数据
     */
    normalizeAudioLength(audio, sampleRate, targetDuration = 3) {
        const targetLength = Math.floor(sampleRate * targetDuration);
        
        // 如果音频长度小于目标长度，进行填充
        if (audio.length < targetLength) {
            const result = new Float32Array(targetLength);
            
            // 复制原始数据
            result.set(audio);
            
            // 填充剩余部分（重复或静音）
            const repeats = Math.ceil(targetLength / audio.length);
            for (let i = 1; i < repeats; i++) {
                const offset = i * audio.length;
                const length = Math.min(audio.length, targetLength - offset);
                if (length > 0) {
                    result.set(audio.subarray(0, length), offset);
                }
            }
            
            return result;
        }
        
        // 如果音频长度大于目标长度，随机截取一段
        if (audio.length > targetLength) {
            const maxOffset = audio.length - targetLength;
            const offset = Math.floor(Math.random() * maxOffset);
            return audio.subarray(offset, offset + targetLength);
        }
        
        // 如果长度正好，直接返回
        return audio;
    }

    /**
     * 将AudioBuffer转换为WAV格式的Blob
     * @param {AudioBuffer} audioBuffer - 音频缓冲区
     * @returns {Blob} - WAV格式的Blob
     */
    audioBufferToWav(audioBuffer) {
        const numOfChannels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length * numOfChannels * 2;
        const buffer = new ArrayBuffer(44 + length);
        const view = new DataView(buffer);
        
        // 写入WAV头
        // "RIFF"
        view.setUint8(0, 0x52);
        view.setUint8(1, 0x49);
        view.setUint8(2, 0x46);
        view.setUint8(3, 0x46);
        
        // RIFF chunk size
        view.setUint32(4, 36 + length, true);
        
        // "WAVE"
        view.setUint8(8, 0x57);
        view.setUint8(9, 0x41);
        view.setUint8(10, 0x56);
        view.setUint8(11, 0x45);
        
        // "fmt "
        view.setUint8(12, 0x66);
        view.setUint8(13, 0x6d);
        view.setUint8(14, 0x74);
        view.setUint8(15, 0x20);
        
        // format chunk length
        view.setUint32(16, 16, true);
        
        // sample format (raw)
        view.setUint16(20, 1, true);
        
        // channel count
        view.setUint16(22, numOfChannels, true);
        
        // sample rate
        view.setUint32(24, audioBuffer.sampleRate, true);
        
        // byte rate
        view.setUint32(28, audioBuffer.sampleRate * numOfChannels * 2, true);
        
        // block align
        view.setUint16(32, numOfChannels * 2, true);
        
        // bits per sample
        view.setUint16(34, 16, true);
        
        // "data"
        view.setUint8(36, 0x64);
        view.setUint8(37, 0x61);
        view.setUint8(38, 0x74);
        view.setUint8(39, 0x61);
        
        // data chunk length
        view.setUint32(40, length, true);
        
        // 写入音频数据
        const offset = 44;
        const data = new Int16Array(length / 2);
        
        // 混合所有声道
        if (numOfChannels === 2) {
            // 立体声
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.getChannelData(1);
            
            for (let i = 0; i < audioBuffer.length; i++) {
                const index = i * 2;
                data[index] = Math.max(-1, Math.min(1, left[i])) * 0x7FFF;
                data[index + 1] = Math.max(-1, Math.min(1, right[i])) * 0x7FFF;
            }
        } else {
            // 单声道
            const channel = audioBuffer.getChannelData(0);
            
            for (let i = 0; i < audioBuffer.length; i++) {
                data[i] = Math.max(-1, Math.min(1, channel[i])) * 0x7FFF;
            }
        }
        
        for (let i = 0; i < data.length; i++) {
            view.setInt16(offset + i * 2, data[i], true);
        }
        
        return new Blob([buffer], { type: 'audio/wav' });
    }
} 