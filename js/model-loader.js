/**
 * 模型加载器模块
 * 负责自定义音频分类处理
 */
class ModelLoader {
    constructor() {
        // 模型相关属性
        this.isModelLoaded = false;
        this.classNames = [
            'Bear', 'Cattle', 'Dog', 'Elephants', 'Lion', 
            'Rooster', 'Sheep', 'Wolf', 'Background', 'Human',
            'Fox', 'Owl', 'Snake', 'Frog'
        ]; // 类别名称
        
        // 模型元数据路径
        this.modelMetadataPath = 'models/animal_classifier_metadata.json';
        
        // 用于存储识别结果的历史记录
        this.recognitionHistory = [];
        
        // 用于统计各类别的识别次数
        this.speciesCount = {};
        this.classNames.forEach(className => {
            this.speciesCount[className] = 0;
        });
    }

    /**
     * 加载模型配置
     * @returns {Promise<boolean>} - 是否成功加载
     */
    async loadModel() {
        try {
            console.log('正在加载配置...');
            
            // 尝试加载元数据以获取类别名称
            try {
                const metadataResponse = await fetch(this.modelMetadataPath);
                if (metadataResponse.ok) {
                    const metadata = await metadataResponse.json();
                    if (metadata.classNames && Array.isArray(metadata.classNames)) {
                        this.classNames = metadata.classNames;
                        // 重置物种计数
                        this.speciesCount = {};
                        this.classNames.forEach(className => {
                            this.speciesCount[className] = 0;
                        });
                    }
                }
            } catch (metadataError) {
                console.warn('无法加载模型元数据，使用默认类别名称', metadataError);
            }
            
            // 初始化音频处理功能
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // 模型已加载成功
            this.isModelLoaded = true;
            console.log('配置加载成功');
            
            return true;
        } catch (error) {
            console.error('配置加载失败:', error);
            this.isModelLoaded = false;
            return false;
        }
    }

    /**
     * 预测音频类别
     * @param {Float32Array} audioData - 音频数据
     * @param {number} sampleRate - 采样率
     * @returns {Promise<Object>} - 预测结果
     */
    async predict(audioData, sampleRate) {
        if (!this.isModelLoaded) {
            throw new Error('模型未加载');
        }
        
        try {
            // 提取音频特征（简化版）
            const features = await this.extractFeatures(audioData, sampleRate);
            
            // 在真实场景中，这里应该使用模型进行推理
            // 由于缺少实际模型，我们使用一个基于音频特征的简单规则来模拟分类
            
            // 基于音频特征进行简单分类
            const result = this.classifyBasedOnFeatures(features);
            
            // 返回结果
            return result;
        } catch (error) {
            console.error('预测失败:', error);
            throw error;
        }
    }
    
    /**
     * 提取音频特征
     * @param {Float32Array} audioData - 音频数据
     * @param {number} sampleRate - 采样率
     * @returns {Object} - 音频特征
     */
    async extractFeatures(audioData, sampleRate) {
        try {
            // 创建临时音频上下文
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate});
            
            // 创建音频缓冲区
            const audioBuffer = audioContext.createBuffer(1, audioData.length, sampleRate);
            audioBuffer.getChannelData(0).set(audioData);
            
            // 创建音频源
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            // 创建分析器节点
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);
            
            // 获取频域数据
            const bufferLength = analyser.frequencyBinCount;
            const frequencyData = new Float32Array(bufferLength);
            analyser.getFloatFrequencyData(frequencyData);
            
            // 创建时域数据
            const timeData = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(timeData);
            
            // 计算基本统计特征
            const features = this.computeAudioFeatures(frequencyData, timeData, audioData);
            
            // 清理资源
            source.disconnect();
            await audioContext.close();
            
            return features;
        } catch (error) {
            console.error('特征提取失败:', error);
            throw error;
        }
    }
    
    /**
     * 计算音频特征
     * @param {Float32Array} frequencyData - 频域数据
     * @param {Float32Array} timeData - 时域数据
     * @param {Float32Array} rawAudioData - 原始音频数据
     * @returns {Object} - 计算得到的特征
     */
    computeAudioFeatures(frequencyData, timeData, rawAudioData) {
        // 避免-Infinity值
        const processedFreqData = Array.from(frequencyData).map(v => isFinite(v) ? v : -100);
        
        // 计算频域特征
        const freqMean = processedFreqData.reduce((sum, val) => sum + val, 0) / processedFreqData.length;
        const freqStd = Math.sqrt(
            processedFreqData.reduce((sum, val) => sum + Math.pow(val - freqMean, 2), 0) / processedFreqData.length
        );
        
        // 找出主要频率
        let dominantFreqIndex = 0;
        let maxFreqValue = processedFreqData[0];
        for (let i = 1; i < processedFreqData.length; i++) {
            if (processedFreqData[i] > maxFreqValue) {
                maxFreqValue = processedFreqData[i];
                dominantFreqIndex = i;
            }
        }
        
        // 计算时域特征
        const timeMean = timeData.reduce((sum, val) => sum + val, 0) / timeData.length;
        const timeStd = Math.sqrt(
            timeData.reduce((sum, val) => sum + Math.pow(val - timeMean, 2), 0) / timeData.length
        );
        
        // 计算原始音频数据的统计量
        const rawMean = rawAudioData.reduce((sum, val) => sum + val, 0) / rawAudioData.length;
        const rawMax = Math.max(...rawAudioData);
        const rawMin = Math.min(...rawAudioData);
        const rawRange = rawMax - rawMin;
        
        // 提取过零率 (Zero Crossing Rate)
        let zeroCrossings = 0;
        for (let i = 1; i < rawAudioData.length; i++) {
            if ((rawAudioData[i] >= 0 && rawAudioData[i-1] < 0) || 
                (rawAudioData[i] < 0 && rawAudioData[i-1] >= 0)) {
                zeroCrossings++;
            }
        }
        const zeroCrossingRate = zeroCrossings / rawAudioData.length;
        
        // 返回计算的特征
        return {
            freqMean,
            freqStd,
            dominantFreqIndex,
            maxFreqValue,
            timeMean,
            timeStd,
            rawMean,
            rawMax,
            rawMin,
            rawRange,
            zeroCrossingRate
        };
    }
    
    /**
     * 基于提取的特征进行分类
     * @param {Object} features - 音频特征
     * @returns {Object} - 分类结果
     */
    classifyBasedOnFeatures(features) {
        // 这里实现一个简单的规则分类器
        // 在真实应用中，这里应该是神经网络或其他机器学习模型的推理
        
        // 创建随机但针对特征加权的分数
        const scores = this.classNames.map(() => Math.random());
        
        // 根据各种特征调整概率
        for (let i = 0; i < this.classNames.length; i++) {
            const className = this.classNames[i];
            
            // 模拟不同动物声音的特征规则
            // 这里只是演示，不代表真实动物声音的特征分布
            if (className === 'Bear' && features.freqMean < -50) {
                scores[i] *= 1.5;
            } else if (className === 'Dog' && features.zeroCrossingRate > 0.2) {
                scores[i] *= 1.4;
            } else if (className === 'Bird' && features.dominantFreqIndex > 100) {
                scores[i] *= 1.3;
            } else if (className === 'Wolf' && features.rawRange > 1.5) {
                scores[i] *= 1.2;
            }
            
            // 随机加权确保每次结果有一定变化
            scores[i] *= (0.8 + Math.random() * 0.4);
        }
        
        // 标准化概率
        const sum = scores.reduce((a, b) => a + b, 0);
        const normalizedScores = scores.map(s => s / sum);
        
        // 找出最高概率的类别
        let maxIndex = 0;
        let maxProbability = normalizedScores[0];
        
        for (let i = 1; i < normalizedScores.length; i++) {
            if (normalizedScores[i] > maxProbability) {
                maxProbability = normalizedScores[i];
                maxIndex = i;
            }
        }
        
        // 获取预测的类别
        const predictedClass = this.classNames[maxIndex];
        
        // 创建结果对象
        const result = {
            class: predictedClass,
            probability: maxProbability,
            allProbabilities: normalizedScores,
            timestamp: new Date()
        };
        
        // 更新历史记录
        this.updateRecognitionHistory(result);
        
        return result;
    }

    /**
     * 更新识别历史记录
     * @param {Object} result - 识别结果
     */
    updateRecognitionHistory(result) {
        // 添加到历史记录
        this.recognitionHistory.push(result);
        
        // 限制历史记录长度
        if (this.recognitionHistory.length > 100) {
            this.recognitionHistory.shift();
        }
        
        // 更新物种计数
        this.speciesCount[result.class] = (this.speciesCount[result.class] || 0) + 1;
    }

    /**
     * 获取物种统计数据
     * @returns {Object} - 物种统计数据
     */
    getSpeciesStatistics() {
        return {
            labels: Object.keys(this.speciesCount),
            data: Object.values(this.speciesCount)
        };
    }

    /**
     * 重置统计数据
     */
    resetStatistics() {
        this.recognitionHistory = [];
        this.classNames.forEach(className => {
            this.speciesCount[className] = 0;
        });
    }
    
    /**
     * 释放资源
     */
    dispose() {
        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
        }
    }
} 