/**
 * 阿里云OSS客户端
 * 负责音频上传和下载功能
 */
class OssClient {
    constructor() {
        // OSS配置，实际使用时请替换为您的配置
        this.region = '';
        this.accessKeyId = '';
        this.accessKeySecret = '';
        this.bucket = '';
        this.endpoint = '';
        
        // OSS客户端实例
        this.ossClient = null;
        
        // 是否已初始化
        this.isInitialized = false;
        
        // 自动从配置文件加载OSS配置
        this.loadConfig();
    }

    /**
     * 加载OSS配置
     */
    async loadConfig() {
        try {
            const response = await fetch('models/oss-config.json');
            if (response.ok) {
                const config = await response.json();
                this.region = config.region || '';
                this.accessKeyId = config.accessKeyId || '';
                this.accessKeySecret = config.accessKeySecret || '';
                this.bucket = config.bucket || '';
                this.endpoint = config.endpoint || '';
                
                // 如果所有必要信息都存在，则初始化OSS客户端
                if (this.region && this.accessKeyId && this.accessKeySecret && this.bucket) {
                    this.initializeClient();
                }
            }
        } catch (error) {
            console.warn('无法加载OSS配置:', error);
        }
    }

    /**
     * 手动设置OSS配置
     * @param {Object} config - OSS配置对象
     */
    setConfig(config) {
        this.region = config.region || this.region;
        this.accessKeyId = config.accessKeyId || this.accessKeyId;
        this.accessKeySecret = config.accessKeySecret || this.accessKeySecret;
        this.bucket = config.bucket || this.bucket;
        this.endpoint = config.endpoint || this.endpoint;
        
        // 重新初始化客户端
        this.initializeClient();
    }

    /**
     * 初始化OSS客户端
     */
    initializeClient() {
        try {
            // 确保已引入阿里云OSS SDK
            if (typeof OSS === 'undefined') {
                console.error('阿里云OSS SDK未加载');
                return false;
            }
            
            // 创建OSS客户端实例
            this.ossClient = new OSS({
                region: this.region,
                accessKeyId: this.accessKeyId,
                accessKeySecret: this.accessKeySecret,
                bucket: this.bucket,
                endpoint: this.endpoint,
                // 添加CORS配置，解决etag问题
                cors: true,
                // 重试次数
                retryMax: 3,
                // 使用安全连接
                secure: true,
                // 启用表单上传模式，绕过分片上传的etag问题
                useFetch: true
            });
            
            this.isInitialized = true;
            console.log('OSS客户端初始化成功');
            return true;
        } catch (error) {
            console.error('OSS客户端初始化失败:', error);
            this.isInitialized = false;
            return false;
        }
    }

    /**
     * 获取STS临时凭证
     * @returns {Promise<Object>} - STS临时凭证
     */
    async getStsToken() {
        try {
            const response = await fetch('/api/sts-token');
            if (!response.ok) {
                throw new Error(`HTTP错误 ${response.status}`);
            }
            
            const stsData = await response.json();
            return stsData;
        } catch (error) {
            console.error('获取STS临时凭证失败:', error);
            throw error;
        }
    }

    /**
     * 使用STS凭证初始化OSS客户端
     * @param {Object} stsData - STS临时凭证数据
     * @returns {boolean} - 是否成功初始化
     */
    initWithStsToken(stsData) {
        try {
            if (typeof OSS === 'undefined') {
                console.error('阿里云OSS SDK未加载');
                return false;
            }
            
            this.ossClient = new OSS({
                region: this.region,
                accessKeyId: stsData.AccessKeyId,
                accessKeySecret: stsData.AccessKeySecret,
                stsToken: stsData.SecurityToken,
                bucket: this.bucket,
                endpoint: this.endpoint,
                // 添加CORS配置，解决etag问题
                cors: true,
                // 使用安全连接
                secure: true,
                // 启用表单上传模式，绕过分片上传的etag问题
                useFetch: true
            });
            
            this.isInitialized = true;
            console.log('OSS客户端(STS)初始化成功');
            return true;
        } catch (error) {
            console.error('OSS客户端(STS)初始化失败:', error);
            this.isInitialized = false;
            return false;
        }
    }

    /**
     * 检查是否已初始化
     * @throws {Error} 如果未初始化则抛出错误
     */
    checkInitialized() {
        if (!this.isInitialized || !this.ossClient) {
            throw new Error('OSS客户端未初始化');
        }
    }

    /**
     * 上传音频文件到OSS
     * @param {Blob} audioBlob - 音频Blob对象
     * @param {string} fileName - 文件名
     * @param {Function} progressCallback - 进度回调函数
     * @returns {Promise<string>} - OSS文件URL
     */
    async uploadAudio(audioBlob, fileName, progressCallback = null) {
        this.checkInitialized();
        
        try {
            // 生成唯一文件名
            const timestamp = new Date().getTime();
            const uniqueFileName = `audio/${timestamp}_${fileName}`;
            
            // 使用普通上传替代分片上传
            let result;
            
            // 对于小文件（小于1MB），使用普通上传
            if (audioBlob.size < 1024 * 1024) {
                result = await this.ossClient.put(uniqueFileName, audioBlob);
            } else {
                // 对于大文件，仍然使用分片上传，但添加额外的选项
                result = await this.ossClient.multipartUpload(uniqueFileName, audioBlob, {
                    progress: (p) => {
                        if (progressCallback) {
                            progressCallback(p * 100);
                        }
                    },
                    // 添加自定义MIME类型
                    mime: audioBlob.type || 'audio/wav',
                    // 添加自定义头信息
                    headers: {
                        'x-oss-forbid-overwrite': 'true',
                        'Cache-Control': 'max-age=86400'
                    }
                });
            }
            
            // 获取文件URL
            const fileUrl = this.ossClient.signatureUrl(uniqueFileName);
            
            return {
                url: fileUrl,
                name: uniqueFileName,
                etag: result.etag || result.res.headers.etag
            };
        } catch (error) {
            console.error('音频上传失败:', error);
            throw error;
        }
    }

    /**
     * 从OSS下载音频文件
     * @param {string} fileName - OSS中的文件名
     * @returns {Promise<Blob>} - 音频Blob对象
     */
    async downloadAudio(fileName) {
        this.checkInitialized();
        
        try {
            // 获取文件
            const result = await this.ossClient.get(fileName);
            
            // 将Buffer转换为Blob
            const audioBlob = new Blob([result.content], { type: 'audio/wav' });
            
            return audioBlob;
        } catch (error) {
            console.error('音频下载失败:', error);
            throw error;
        }
    }

    /**
     * 获取OSS文件列表
     * @param {string} prefix - 前缀
     * @returns {Promise<Array>} - 文件列表
     */
    async listAudioFiles(prefix = 'audio/') {
        this.checkInitialized();
        
        try {
            // 设置列表参数
            const options = {
                prefix: prefix,
                delimiter: '/'
            };
            
            // 获取文件列表
            const result = await this.ossClient.list(options);
            
            return result.objects || [];
        } catch (error) {
            console.error('获取音频文件列表失败:', error);
            throw error;
        }
    }

    /**
     * 删除OSS中的文件
     * @param {string} fileName - 文件名
     * @returns {Promise<boolean>} - 是否成功删除
     */
    async deleteFile(fileName) {
        this.checkInitialized();
        
        try {
            await this.ossClient.delete(fileName);
            return true;
        } catch (error) {
            console.error('文件删除失败:', error);
            throw error;
        }
    }

    /**
     * 创建音频文件的URL
     * @param {string} fileName - OSS中的文件名
     * @param {number} expireTime - URL过期时间（秒），默认3600秒
     * @returns {string} - 签名URL
     */
    createAudioUrl(fileName, expireTime = 3600) {
        this.checkInitialized();
        
        try {
            const url = this.ossClient.signatureUrl(fileName, { expires: expireTime });
            return url;
        } catch (error) {
            console.error('创建签名URL失败:', error);
            throw error;
        }
    }
} 