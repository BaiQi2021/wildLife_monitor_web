/**
 * 音频可视化模块
 * 负责音频波形和频谱的可视化
 */
class AudioVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.canvasCtx = this.canvas.getContext('2d');
        this.analyser = null;
        this.dataArray = null;
        this.bufferLength = 0;
        this.animationId = null;
        this.mode = 'waveform'; // 'waveform' 或 'spectrum'
        this.gradient = null;
        this.setupCanvas();
    }

    /**
     * 设置画布尺寸和基本属性
     */
    setupCanvas() {
        // 获取画布容器的尺寸
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        // 创建渐变
        this.gradient = this.canvasCtx.createLinearGradient(0, 0, 0, this.canvas.height);
        this.gradient.addColorStop(0, '#2c7a56'); // 主题色
        this.gradient.addColorStop(0.5, '#4caf50');
        this.gradient.addColorStop(1, '#8bc34a');
        
        // 初始化空画布
        this.canvasCtx.fillStyle = '#f9f9f9'; // 背景色
        this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * 设置音频分析器
     * @param {AnalyserNode} analyser - Web Audio API 分析器节点
     */
    setAnalyser(analyser) {
        this.analyser = analyser;
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
    }

    /**
     * 开始可视化动画
     */
    startVisualization() {
        // 如果已经在运行，停止它
        if (this.animationId) {
            this.stopVisualization();
        }
        
        // 确保分析器已设置
        if (!this.analyser) {
            console.error('未设置音频分析器');
            return;
        }
        
        // 根据模式选择绘制函数
        const draw = this.mode === 'waveform' ? this.drawWaveform.bind(this) : this.drawSpectrum.bind(this);
        
        // 开始动画循环
        const animate = () => {
            this.animationId = requestAnimationFrame(animate);
            draw();
        };
        
        animate();
    }

    /**
     * 停止可视化动画
     */
    stopVisualization() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
            
            // 清除画布
            this.canvasCtx.fillStyle = '#f9f9f9';
            this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    /**
     * 切换可视化模式
     * @param {string} mode - 'waveform' 或 'spectrum'
     */
    setMode(mode) {
        if (mode === 'waveform' || mode === 'spectrum') {
            this.mode = mode;
            
            // 如果正在可视化，重新启动
            if (this.animationId) {
                this.stopVisualization();
                this.startVisualization();
            }
        }
    }

    /**
     * 绘制波形图
     */
    drawWaveform() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // 获取时域数据
        this.analyser.getByteTimeDomainData(this.dataArray);
        
        // 清除画布
        this.canvasCtx.fillStyle = '#f9f9f9';
        this.canvasCtx.fillRect(0, 0, width, height);
        
        // 绘制波形
        this.canvasCtx.lineWidth = 2;
        this.canvasCtx.strokeStyle = this.gradient;
        this.canvasCtx.beginPath();
        
        const sliceWidth = width / this.bufferLength;
        let x = 0;
        
        for (let i = 0; i < this.bufferLength; i++) {
            const v = this.dataArray[i] / 128.0; // 将 0-255 转换为 0-2
            const y = v * height / 2;
            
            if (i === 0) {
                this.canvasCtx.moveTo(x, y);
            } else {
                this.canvasCtx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        this.canvasCtx.lineTo(width, height / 2);
        this.canvasCtx.stroke();
    }

    /**
     * 绘制频谱图
     */
    drawSpectrum() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // 获取频域数据
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // 清除画布
        this.canvasCtx.fillStyle = '#f9f9f9';
        this.canvasCtx.fillRect(0, 0, width, height);
        
        // 计算柱状图宽度
        const barWidth = (width / this.bufferLength) * 2.5;
        let x = 0;
        
        // 绘制频谱柱状图
        for (let i = 0; i < this.bufferLength; i++) {
            const barHeight = (this.dataArray[i] / 255) * height;
            
            this.canvasCtx.fillStyle = this.gradient;
            this.canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1; // 添加1像素间隔
            
            // 只绘制前 80 个频段(低频段)，超出画布就退出
            if (x > width) break;
        }
    }

    /**
     * 响应窗口大小变化
     */
    handleResize() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        // 重新创建渐变
        this.gradient = this.canvasCtx.createLinearGradient(0, 0, 0, this.canvas.height);
        this.gradient.addColorStop(0, '#2c7a56');
        this.gradient.addColorStop(0.5, '#4caf50');
        this.gradient.addColorStop(1, '#8bc34a');
    }
} 