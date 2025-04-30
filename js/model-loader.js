/**
 * 模型加载器模块
 * 负责自定义音频分类处理
 */
class ModelLoader {
    constructor() {
        // 模型相关属性
        this.isModelLoaded = false;
        this.model = null; // TensorFlow.js 模型
        this.classNames = [
            'Bear', 'Cattle', 'Dog', 'Elephants', 'Lion',
            'Rooster', 'Sheep', 'Wolf', 'Background', 'Human',
            'Fox', 'Owl', 'Snake', 'Frog'
        ]; // 类别名称

        // 模型路径
        this.modelPath = 'models/animal_classifier_model/model.json';
        this.modelMetadataPath = 'models/animal_classifier_metadata.json';

        // 模型输入形状
        this.inputShape = [128, 94]; // 默认值，将从元数据中更新

        // 用于存储识别结果的历史记录
        this.recognitionHistory = [];

        // 用于统计各类别的识别次数（当前会话）
        this.speciesCount = {};
        this.classNames.forEach(className => {
            this.speciesCount[className] = 0;
        });

        // 用于存储历史数据（持久化）
        this.historicalSpeciesCount = {};
        this.classNames.forEach(className => {
            this.historicalSpeciesCount[className] = 0;
        });

        // 从本地存储加载历史数据
        this.loadHistoricalData();
    }

    /**
     * 加载模型配置和TensorFlow.js模型
     * @returns {Promise<boolean>} - 是否成功加载
     */
    async loadModel() {
        try {
            console.log('正在加载配置和模型...');

            // 1. 首先加载元数据以获取类别名称和输入形状
            try {
                console.log('加载元数据...');
                const metadataResponse = await fetch(this.modelMetadataPath);
                if (metadataResponse.ok) {
                    const metadata = await metadataResponse.json();
                    console.log('元数据加载成功:', metadata);

                    // 更新类别名称
                    if (metadata.classNames && Array.isArray(metadata.classNames)) {
                        this.classNames = metadata.classNames;
                        // 重置物种计数
                        this.speciesCount = {};
                        this.classNames.forEach(className => {
                            this.speciesCount[className] = 0;
                        });
                    }

                    // 更新输入形状
                    if (metadata.inputShape) {
                        this.inputShape = metadata.inputShape;
                        console.log('模型输入形状:', this.inputShape);
                    }
                }
            } catch (metadataError) {
                console.warn('无法加载模型元数据，使用默认类别名称和输入形状', metadataError);
            }

            // 2. 加载TensorFlow.js模型
            try {
                console.log('加载TensorFlow.js模型:', this.modelPath);
                this.model = await tf.loadLayersModel(this.modelPath);
                console.log('模型加载成功:', this.model);

                // 输出模型摘要
                this.model.summary();

                // 预热模型 - 进行一次推理以确保模型已完全加载
                const dummyInput = tf.zeros([1, ...this.inputShape, 1]);
                const warmupResult = this.model.predict(dummyInput);
                warmupResult.dispose(); // 释放资源
                dummyInput.dispose(); // 释放资源

                console.log('模型预热完成');
            } catch (modelError) {
                console.error('模型加载失败:', modelError);
                throw new Error('无法加载TensorFlow.js模型: ' + modelError.message);
            }

            // 3. 初始化音频处理功能
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // 模型已加载成功
            this.isModelLoaded = true;
            console.log('配置和模型加载成功');

            return true;
        } catch (error) {
            console.error('配置或模型加载失败:', error);
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
        if (!this.isModelLoaded || !this.model) {
            throw new Error('模型未加载');
        }

        try {
            console.log('开始预测...');

            // 1. 提取音频特征
            const featureTensor = await this.extractFeatures(audioData, sampleRate);

            // 2. 使用模型进行推理
            console.log('执行模型推理...');
            const predictionTensor = this.model.predict(featureTensor);

            // 3. 将预测结果转换为JavaScript数组
            const predictions = await predictionTensor.data();

            // 4. 找出最高概率的类别
            let maxIndex = 0;
            let maxProbability = predictions[0];

            for (let i = 1; i < predictions.length; i++) {
                if (predictions[i] > maxProbability) {
                    maxProbability = predictions[i];
                    maxIndex = i;
                }
            }

            // 5. 获取预测的类别
            const predictedClass = this.classNames[maxIndex];

            // 6. 创建结果对象
            const result = {
                class: predictedClass,
                probability: maxProbability,
                allProbabilities: Array.from(predictions),
                timestamp: new Date()
            };

            // 7. 更新历史记录
            this.updateRecognitionHistory(result);

            // 8. 清理TensorFlow资源
            featureTensor.dispose();
            predictionTensor.dispose();

            console.log('预测完成:', result);

            // 返回结果
            return result;
        } catch (error) {
            console.error('预测失败:', error);
            throw error;
        }
    }

    /*
     * 提取音频特征 - 梅尔频谱图
     * @param {Float32Array} audioData - 音频数据
     * @param {number} sampleRate - 采样率
     * @returns {tf.Tensor} - 音频特征张量，形状为 [1, inputShape[0], inputShape[1], 1]
     */
    async extractFeatures(audioData, sampleRate) {
        try {
            console.log('开始提取音频特征...');

            // 参数设置 - 与Python端保持一致
            const n_fft = 2048;
            const hop_length = 512;
            const n_mels = this.inputShape[0]; // 通常为128

            // 1. 创建临时音频上下文
            const audioContext = new (window.AudioContext || window.webkitAudioContext)({sampleRate});

            // 2. 创建音频缓冲区
            const audioBuffer = audioContext.createBuffer(1, audioData.length, sampleRate);
            audioBuffer.getChannelData(0).set(audioData);

            // 3. 使用Web Audio API的分析器获取频域数据
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = n_fft;

            // 创建音频源并连接分析器
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(analyser);

            // 4. 计算梅尔频谱图
            // 由于Web Audio API没有直接的梅尔频谱图计算，我们需要手动实现
            // 首先获取频域数据
            const frequencyData = new Float32Array(analyser.frequencyBinCount);

            // 创建一个足够大的数组来存储所有帧的频域数据
            const numFrames = Math.floor((audioData.length - n_fft) / hop_length) + 1;
            const melSpectrogram = new Array(numFrames);

            // 模拟滑动窗口处理
            for (let i = 0; i < numFrames; i++) {
                // 计算当前帧的起始位置
                const startSample = i * hop_length;

                // 提取当前帧的音频数据
                const frameData = audioData.slice(startSample, startSample + n_fft);

                // 使用FFT计算频谱
                const fft = new FFT(n_fft);
                const fftInput = new Array(n_fft).fill(0);
                for (let j = 0; j < frameData.length; j++) {
                    fftInput[j] = frameData[j];
                }

                // 应用窗函数（汉宁窗）
                for (let j = 0; j < n_fft; j++) {
                    fftInput[j] *= 0.5 * (1 - Math.cos(2 * Math.PI * j / (n_fft - 1)));
                }

                // 计算FFT
                const fftOutput = fft.createComplexArray();
                fft.realTransform(fftOutput, fftInput);

                // 计算功率谱
                const powerSpectrum = new Array(n_fft / 2);
                for (let j = 0; j < n_fft / 2; j++) {
                    const real = fftOutput[2 * j];
                    const imag = fftOutput[2 * j + 1];
                    powerSpectrum[j] = (real * real + imag * imag) / n_fft;
                }

                // 简化的梅尔滤波器组应用
                // 这里我们使用一个简化的方法来模拟梅尔滤波器组
                const melFrame = new Array(n_mels).fill(0);
                const fftBins = n_fft / 2;

                // 简化的梅尔滤波器应用
                for (let mel_i = 0; mel_i < n_mels; mel_i++) {
                    // 计算当前梅尔滤波器的频率范围
                    const mel_start = mel_i * (fftBins / n_mels);
                    const mel_end = (mel_i + 1) * (fftBins / n_mels);

                    // 应用梅尔滤波器
                    let sum = 0;
                    let count = 0;
                    for (let bin = Math.floor(mel_start); bin < Math.floor(mel_end); bin++) {
                        if (bin < powerSpectrum.length) {
                            sum += powerSpectrum[bin];
                            count++;
                        }
                    }

                    // 计算平均值
                    melFrame[mel_i] = count > 0 ? sum / count : 0;
                }

                // 转换为分贝单位
                for (let j = 0; j < n_mels; j++) {
                    melFrame[j] = 10 * Math.log10(Math.max(1e-10, melFrame[j]));
                }

                melSpectrogram[i] = melFrame;
            }

            // 5. 转置梅尔频谱图以匹配模型输入格式 [n_mels, time]
            const transposedMelSpec = new Array(n_mels);
            for (let i = 0; i < n_mels; i++) {
                transposedMelSpec[i] = new Array(melSpectrogram.length);
                for (let j = 0; j < melSpectrogram.length; j++) {
                    transposedMelSpec[i][j] = melSpectrogram[j][i];
                }
            }

            // 6. 标准化到 [0, 1] 范围
            // 找出最大值和最小值
            let minVal = Infinity;
            let maxVal = -Infinity;

            for (let i = 0; i < n_mels; i++) {
                for (let j = 0; j < transposedMelSpec[i].length; j++) {
                    minVal = Math.min(minVal, transposedMelSpec[i][j]);
                    maxVal = Math.max(maxVal, transposedMelSpec[i][j]);
                }
            }

            // 标准化
            const normalizedMelSpec = new Array(n_mels);
            for (let i = 0; i < n_mels; i++) {
                normalizedMelSpec[i] = new Array(transposedMelSpec[i].length);
                for (let j = 0; j < transposedMelSpec[i].length; j++) {
                    normalizedMelSpec[i][j] = (transposedMelSpec[i][j] - minVal) / (maxVal - minVal);
                }
            }

            // 7. 调整大小以匹配模型输入形状
            const targetTimeSteps = this.inputShape[1]; // 通常为94
            const resizedMelSpec = new Array(n_mels);

            for (let i = 0; i < n_mels; i++) {
                resizedMelSpec[i] = new Array(targetTimeSteps);

                // 简单的线性插值
                const srcLength = normalizedMelSpec[i].length;
                for (let j = 0; j < targetTimeSteps; j++) {
                    const srcIdx = j * (srcLength - 1) / (targetTimeSteps - 1);
                    const srcIdxFloor = Math.floor(srcIdx);
                    const srcIdxCeil = Math.min(srcIdxFloor + 1, srcLength - 1);
                    const alpha = srcIdx - srcIdxFloor;

                    resizedMelSpec[i][j] = (1 - alpha) * normalizedMelSpec[i][srcIdxFloor] +
                                          alpha * normalizedMelSpec[i][srcIdxCeil];
                }
            }

            // 8. 转换为TensorFlow.js张量
            // 首先将二维数组展平为一维
            const flattenedData = [];
            for (let i = 0; i < n_mels; i++) {
                for (let j = 0; j < targetTimeSteps; j++) {
                    flattenedData.push(resizedMelSpec[i][j]);
                }
            }

            // 创建张量并重塑为所需形状 [1, n_mels, targetTimeSteps, 1]
            const tensor = tf.tensor(flattenedData).reshape([1, n_mels, targetTimeSteps, 1]);

            // 清理资源
            source.disconnect();
            await audioContext.close();

            console.log('特征提取完成，形状:', tensor.shape);

            return tensor;
        } catch (error) {
            console.error('特征提取失败:', error);
            throw error;
        }
    }

    /**
     * 在dispose方法中添加模型资源释放
     */

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

        // 更新当前会话物种计数
        this.speciesCount[result.class] = (this.speciesCount[result.class] || 0) + 1;

        // 更新历史物种计数
        this.historicalSpeciesCount[result.class] = (this.historicalSpeciesCount[result.class] || 0) + 1;

        // 保存历史数据到本地存储
        this.saveHistoricalData();
    }

    /**
     * 从本地存储加载历史数据
     */
    loadHistoricalData() {
        try {
            const savedData = localStorage.getItem('wildlifeAudioHistoricalData');
            if (savedData) {
                const parsedData = JSON.parse(savedData);

                // 确保所有类别都存在
                this.classNames.forEach(className => {
                    if (typeof parsedData[className] === 'undefined') {
                        parsedData[className] = 0;
                    }
                });

                this.historicalSpeciesCount = parsedData;
                console.log('已加载历史数据:', this.historicalSpeciesCount);
            }
        } catch (error) {
            console.error('加载历史数据失败:', error);
            // 如果加载失败，重置历史数据
            this.classNames.forEach(className => {
                this.historicalSpeciesCount[className] = 0;
            });
        }
    }

    /**
     * 保存历史数据到本地存储
     */
    saveHistoricalData() {
        try {
            localStorage.setItem('wildlifeAudioHistoricalData', JSON.stringify(this.historicalSpeciesCount));
        } catch (error) {
            console.error('保存历史数据失败:', error);
        }
    }

    /**
     * 获取当前会话物种统计数据
     * @returns {Object} - 物种统计数据
     */
    getSpeciesStatistics() {
        return {
            labels: Object.keys(this.speciesCount),
            data: Object.values(this.speciesCount)
        };
    }

    /**
     * 获取历史物种统计数据
     * @returns {Object} - 历史物种统计数据
     */
    getHistoricalSpeciesStatistics() {
        return {
            labels: Object.keys(this.historicalSpeciesCount),
            data: Object.values(this.historicalSpeciesCount)
        };
    }

    /**
     * 重置当前会话统计数据
     */
    resetStatistics() {
        this.recognitionHistory = [];
        this.classNames.forEach(className => {
            this.speciesCount[className] = 0;
        });
    }

    /**
     * 重置历史统计数据
     */
    resetHistoricalStatistics() {
        this.classNames.forEach(className => {
            this.historicalSpeciesCount[className] = 0;
        });

        // 保存重置后的历史数据
        this.saveHistoricalData();

        return {
            labels: Object.keys(this.historicalSpeciesCount),
            data: Object.values(this.historicalSpeciesCount)
        };
    }

    /**
     * 释放资源
     */
    dispose() {
        // 释放音频上下文
        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
        }

        // 释放TensorFlow.js模型资源
        if (this.model) {
            try {
                this.model.dispose();
                console.log('模型资源已释放');
            } catch (error) {
                console.error('释放模型资源时出错:', error);
            }
        }

        // 清除其他资源
        this.isModelLoaded = false;
        this.model = null;
    }
}