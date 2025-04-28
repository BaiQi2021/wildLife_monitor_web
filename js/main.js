/**
 * 野生动物音频识别系统 - 主应用逻辑
 */
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化模块
    const visualizer = new AudioVisualizer('audioVisualizer');
    const audioProcessor = new AudioProcessor(visualizer);
    const modelLoader = new ModelLoader();
    const ossClient = new OssClient();
    
    // DOM元素
    const startMonitoringBtn = document.getElementById('startMonitoring');
    const stopMonitoringBtn = document.getElementById('stopMonitoring');
    const realTimeStatus = document.getElementById('realTimeStatus');
    const uploadAudioBtn = document.getElementById('uploadAudio');
    const audioFileInput = document.getElementById('audioFileInput');
    const fileInfo = document.getElementById('fileInfo');
    const uploadStatus = document.getElementById('uploadStatus');
    const resultPanel = document.getElementById('resultPanel');
    const audioPlayer = document.getElementById('audioPlayer');
    const audioPlayerContainer = document.getElementById('audioPlayerContainer');
    
    // 状态变量
    let isMonitoring = false;
    let selectedFile = null;
    let recognitionCount = 0;
    let monitoringInterval = null;
    let chart = null; // 图表实例
    
    // 初始化音频处理器
    await audioProcessor.initialize();
    
    // 初始化图表
    initChart();
    
    // 加载模型
    try {
        realTimeStatus.textContent = '状态: 正在加载模型...';
        const modelLoaded = await modelLoader.loadModel();
        if (modelLoaded) {
            realTimeStatus.textContent = '状态: 模型加载成功，准备就绪';
        } else {
            realTimeStatus.textContent = '状态: 模型加载失败';
        }
    } catch (error) {
        console.error('模型加载错误:', error);
        realTimeStatus.textContent = '状态: 模型加载失败 - ' + error.message;
    }

    // 事件监听器
    startMonitoringBtn.addEventListener('click', startMonitoring);
    stopMonitoringBtn.addEventListener('click', stopMonitoring);
    audioFileInput.addEventListener('change', handleFileSelect);
    uploadAudioBtn.addEventListener('click', uploadAndAnalyzeAudio);
    
    // 窗口调整大小时更新可视化器
    window.addEventListener('resize', () => {
        visualizer.handleResize();
    });

    /**
     * 初始化图表
     */
    function initChart() {
        const ctx = document.getElementById('speciesChart').getContext('2d');
        
        // 创建饼图
        chart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: [],
                datasets: [{
                    data: [],
                    backgroundColor: [
                        '#2c7a56', '#4caf50', '#8bc34a', '#cddc39', 
                        '#ffeb3b', '#ffc107', '#ff9800', '#ff5722',
                        '#795548', '#9e9e9e', '#607d8b'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            font: {
                                size: 12
                            }
                        }
                    },
                    title: {
                        display: true,
                        text: '物种识别统计',
                        font: {
                            size: 16
                        }
                    }
                }
            }
        });
    }
    
    /**
     * 开始实时监测
     */
    async function startMonitoring() {
        if (isMonitoring) return;
        
        // 检查模型是否已加载
        if (!modelLoader.isModelLoaded) {
            realTimeStatus.textContent = '状态: 模型未加载，无法开始监测';
            return;
        }
        
        try {
            // 请求麦克风权限
            realTimeStatus.textContent = '状态: 请求麦克风权限...';
            const microphoneAccess = await audioProcessor.requestMicrophoneAccess();
            
            if (!microphoneAccess) {
                realTimeStatus.textContent = '状态: 获取麦克风权限失败';
                return;
            }
            
            // 开始监测
            isMonitoring = true;
            recognitionCount = 0;
            realTimeStatus.textContent = '状态: 正在监测...';
            
            // 更新UI
            startMonitoringBtn.disabled = true;
            stopMonitoringBtn.disabled = false;
            
            // 每3秒录制一次音频并进行识别
            monitoringInterval = setInterval(() => {
                if (isMonitoring) {
                    audioProcessor.startRecording(async (audioBlob) => {
                        await processRecordedAudio(audioBlob);
                    });
                }
            }, 4000); // 4秒间隔，考虑到处理时间
            
        } catch (error) {
            console.error('开始监测时发生错误:', error);
            realTimeStatus.textContent = '状态: 开始监测失败 - ' + error.message;
        }
    }
    
    /**
     * 停止实时监测
     */
    function stopMonitoring() {
        if (!isMonitoring) return;
        
        // 清除定时器
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }
        
        // 停止录制
        audioProcessor.stopRecording();
        
        // 释放资源
        audioProcessor.releaseResources();
        
        // 更新状态
        isMonitoring = false;
        realTimeStatus.textContent = `状态: 监测已停止，共进行了 ${recognitionCount} 次识别`;
        
        // 更新UI
        startMonitoringBtn.disabled = false;
        stopMonitoringBtn.disabled = true;
    }
    
    /**
     * 处理录制的音频
     * @param {Blob} audioBlob - 录制的音频Blob
     */
    async function processRecordedAudio(audioBlob) {
        try {
            // 更新状态
            realTimeStatus.textContent = '状态: 处理音频...';
            
            // 加载音频
            const audioBuffer = await audioProcessor.loadAudioFile(audioBlob);
            
            // 重采样到16kHz
            const resampledAudio = audioProcessor.resampleAudio(audioBuffer, 16000);
            
            // 标准化长度
            const normalizedAudio = audioProcessor.normalizeAudioLength(resampledAudio, 16000);
            
            // 预测物种
            const result = await modelLoader.predict(normalizedAudio, 16000);
            
            // 更新识别次数
            recognitionCount++;
            
            // 显示结果
            displayResult(result, audioBlob);
            
            // 更新图表
            updateChart();
            
            // 更新状态
            realTimeStatus.textContent = `状态: 检测到 ${result.class}，正在继续监测...`;
            
        } catch (error) {
            console.error('处理音频时发生错误:', error);
            realTimeStatus.textContent = '状态: 音频处理失败 - ' + error.message;
        }
    }
    
    /**
     * 处理文件选择
     * @param {Event} event - 文件选择事件
     */
    function handleFileSelect(event) {
        const files = event.target.files;
        if (files.length === 0) {
            fileInfo.textContent = '未选择文件';
            selectedFile = null;
            uploadAudioBtn.disabled = true;
            return;
        }
        
        // 获取选中的文件
        selectedFile = files[0];
        
        // 检查文件类型
        if (!selectedFile.type.startsWith('audio/')) {
            fileInfo.textContent = '请选择音频文件';
            selectedFile = null;
            uploadAudioBtn.disabled = true;
            return;
        }
        
        // 显示文件信息
        const fileSize = (selectedFile.size / 1024).toFixed(2);
        fileInfo.textContent = `已选择：${selectedFile.name} (${fileSize} KB)`;
        uploadAudioBtn.disabled = false;
    }
    
    /**
     * 上传并分析音频
     */
    async function uploadAndAnalyzeAudio() {
        if (!selectedFile) {
            uploadStatus.textContent = '状态: 请先选择音频文件';
            return;
        }
        
        try {
            // 更新状态
            uploadStatus.textContent = '状态: 处理音频...';
            uploadAudioBtn.disabled = true;
            
            // 加载音频
            const audioProcessor = new AudioProcessor(null);
            await audioProcessor.initialize();
            
            const audioBuffer = await audioProcessor.loadAudioFile(selectedFile);
            
            // 重采样到16kHz
            const resampledAudio = audioProcessor.resampleAudio(audioBuffer, 16000);
            
            // 标准化长度
            const normalizedAudio = audioProcessor.normalizeAudioLength(resampledAudio, 16000);
            
            // 预测物种
            const result = await modelLoader.predict(normalizedAudio, 16000);
            
            // 显示结果
            displayResult(result, selectedFile);
            
            // 更新图表
            updateChart();
            
            // 上传到OSS（如果配置了）
            if (ossClient.isInitialized) {
                uploadStatus.textContent = '状态: 正在上传到OSS...';
                
                try {
                    // 尝试使用修改后的上传方法
                    const uploadResult = await ossClient.uploadAudio(selectedFile, selectedFile.name, (progress) => {
                        uploadStatus.textContent = `状态: 上传中 ${progress.toFixed(1)}%`;
                    });
                    
                    uploadStatus.textContent = '状态: 上传成功';
                    console.log('上传结果:', uploadResult);
                } catch (ossError) {
                    console.error('标准上传到OSS失败，尝试使用本地存储:', ossError);
                    uploadStatus.textContent = '状态: OSS上传失败，使用本地存储';
                    
                    // 使用本地存储作为备选方案
                    try {
                        // 保存音频URL到本地存储
                        const audioUrl = URL.createObjectURL(selectedFile);
                        const timestamp = new Date().getTime();
                        const uniqueFileName = `audio_${timestamp}_${selectedFile.name}`;
                        
                        // 存储最近的5个音频文件URL
                        let recentAudioFiles = JSON.parse(localStorage.getItem('recentAudioFiles') || '[]');
                        recentAudioFiles.push({
                            name: uniqueFileName,
                            url: audioUrl,
                            timestamp: timestamp,
                            class: result.class,
                            probability: result.probability
                        });
                        
                        // 保留最近的5个
                        if (recentAudioFiles.length > 5) {
                            // 释放旧的URL
                            URL.revokeObjectURL(recentAudioFiles[0].url);
                            recentAudioFiles.shift();
                        }
                        
                        localStorage.setItem('recentAudioFiles', JSON.stringify(recentAudioFiles));
                        uploadStatus.textContent = '状态: 已保存到本地缓存，分析完成';
                    } catch (localError) {
                        console.error('本地存储失败:', localError);
                        uploadStatus.textContent = '状态: 本地保存失败，但分析已完成';
                    }
                }
            } else {
                uploadStatus.textContent = '状态: 分析完成，未配置OSS，使用本地存储';
                
                // 使用本地存储
                try {
                    // 保存音频URL到本地存储
                    const audioUrl = URL.createObjectURL(selectedFile);
                    const timestamp = new Date().getTime();
                    const uniqueFileName = `audio_${timestamp}_${selectedFile.name}`;
                    
                    // 存储最近的5个音频文件URL
                    let recentAudioFiles = JSON.parse(localStorage.getItem('recentAudioFiles') || '[]');
                    recentAudioFiles.push({
                        name: uniqueFileName,
                        url: audioUrl,
                        timestamp: timestamp,
                        class: result.class,
                        probability: result.probability
                    });
                    
                    // 保留最近的5个
                    if (recentAudioFiles.length > 5) {
                        // 释放旧的URL
                        URL.revokeObjectURL(recentAudioFiles[0].url);
                        recentAudioFiles.shift();
                    }
                    
                    localStorage.setItem('recentAudioFiles', JSON.stringify(recentAudioFiles));
                    uploadStatus.textContent = '状态: 已保存到本地缓存，分析完成';
                } catch (localError) {
                    console.error('本地存储失败:', localError);
                    uploadStatus.textContent = '状态: 本地保存失败，但分析已完成';
                }
            }
            
            // 重置UI
            uploadAudioBtn.disabled = false;
        } catch (error) {
            console.error('处理上传音频时发生错误:', error);
            uploadStatus.textContent = '状态: 音频处理失败 - ' + error.message;
            uploadAudioBtn.disabled = false;
        }
    }
    
    /**
     * 显示识别结果
     * @param {Object} result - 识别结果
     * @param {Blob} audioBlob - 音频Blob
     */
    function displayResult(result, audioBlob) {
        // 创建结果HTML
        let resultHTML = `
            <div class="result-item">
                <h3>识别结果</h3>
                <div class="result-content">
                    <p class="result-class">物种：<strong>${result.class}</strong></p>
                    <p class="result-probability">置信度：${(result.probability * 100).toFixed(2)}%</p>
                    <div class="result-probabilities">
                        <h4>所有类别概率：</h4>
                        <ul>
        `;
        
        // 添加所有概率
        const sortedIndices = result.allProbabilities
            .map((prob, idx) => ({ prob, idx }))
            .sort((a, b) => b.prob - a.prob);
        
        for (let i = 0; i < Math.min(5, sortedIndices.length); i++) {
            const { prob, idx } = sortedIndices[i];
            const className = modelLoader.classNames[idx];
            resultHTML += `<li>${className}: ${(prob * 100).toFixed(2)}%</li>`;
        }
        
        resultHTML += `
                        </ul>
                    </div>
                </div>
            </div>
        `;
        
        // 更新结果面板
        resultPanel.innerHTML = resultHTML;
        
        // 播放音频
        if (audioBlob) {
            const audioUrl = URL.createObjectURL(audioBlob);
            audioPlayer.src = audioUrl;
            audioPlayerContainer.style.display = 'block';
        }
    }
    
    /**
     * 更新图表
     */
    function updateChart() {
        const stats = modelLoader.getSpeciesStatistics();
        
        // 过滤掉计数为0的物种
        const nonZeroIndices = stats.data.map((count, idx) => ({ count, idx }))
            .filter(item => item.count > 0);
        
        // 更新图表数据
        chart.data.labels = nonZeroIndices.map(item => stats.labels[item.idx]);
        chart.data.datasets[0].data = nonZeroIndices.map(item => item.count);
        
        // 更新图表
        chart.update();
    }
}); 