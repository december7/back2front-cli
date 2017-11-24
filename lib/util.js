/*!
 * Command line tools for Back2Front
 * 工具函数
 */

'use strict';


/**
 * 输出错误信息并退出
 * @method errorExit
 * @param {String} msg 错误信息
 */
exports.errorExit = function(msg) {
	console.error(msg);
	process.exit(1);
};


/**
 * 判断指定字符串是否URL
 * @method isURL
 * @param {String} str 指定字符串
 * @return {Boolean} 指定字符串是否URL
 */
exports.isURL = function(str) { return /^([a-z]+:)?\/\//i.test(str); };

/**
 * 判断指定字符串是否Base64编码数据
 * @method isURL
 * @param {String} str 指定字符串
 * @return {Boolean} 指定字符串是否Base64编码数据
 */
exports.isBase64 = function(str) { return /^data:/i.test(str); };


var extnameMap = {
	'.xtpl': '.xtpl.js',
	'.css': '.css.js',
	headjs: '.raw.js',
	js: '.raw.js',
	css: '.css.js',
	modjs: '.js'
};
/**
 * 替换路径中的扩展名为资源最终扩展名
 * @method convertExtname
 * @param {String} filePath 文件路径
 * @param {String} [fileType] 文件类型
 * @return {String} 替换后的文件路径
 */
exports.convertExtname = function(filePath, fileType) {
	// 不能直接用path.extname，因为存在多个后缀的情况(如.raw.js)
	var re_extname = /(?:\.\w+)+$/;
	
	if (re_extname.test(filePath)) {
		filePath = filePath.replace(re_extname, function(extname) {
			return extnameMap[fileType || extname] || extname;
		});
	} else {
		filePath += extnameMap[fileType];
	}

	return filePath;
};


var reversedExtnameMap = {
	'.xtpl.js': '.xtpl',
	'.css.js': '.css'
};
exports.revertExtname = function(filePath) {
	// 不能直接用path.extname，因为存在多个后缀的情况(如.raw.js)
	var re_extname = /(?:\.\w+)+$/;

	if (re_extname.test(filePath)) {
		filePath = filePath.replace(re_extname, function(extname) {
			return reversedExtnameMap[extname] || extname;
		});
	}

	return filePath;
};


/**
 * 把指定字符串中的变量占位符({$name})替换成值
 * @method parseVars
 * @param {String} str 指定字符串
 * @param {Object} data 值映射表
 * @return {String} 替换后的字符串
 */
exports.parseVars = function(str, data) {
	return str.replace(/\{\$(\w+)\}/g, function(match, $1) {
		return data[$1] == null ? '' : data[$1];
	})
};


/**
 * 替换指定字符串中的“\”为“/”
 * @method normalizeSlash
 * @param {String} str 指定字符串
 * @return {String} 替换后的字符串
 */
exports.normalizeSlash = function(str) { return str.replace(/\\/g, '/'); };


var crypto = require('crypto');
/**
 * 计算指定字符串的MD5值
 * @method calcMd5
 * @param {String} str 指定字符串
 * @param {Number} [length] 如果为大于0的数字，则截取特定长度的MD5值
 * @return {String} 计算结果
 */
exports.calcMd5 = function(str, length) {
	var md5 = crypto.createHash('md5');
	md5.update(str);

	var result = md5.digest('hex');
	if (length) { result = result.substr(0, length); }
	return result;
};


var fs = require('fs'), fileCache = { };
/**
 * 读取文件
 * @method readFile
 * @param {String} filePath 文件路径
 * @param {Boolean} [cache=false] 是否缓存文件内容
 * @return {String} 文件内容
 */
exports.readFile = function(filePath, cache) {
	var fileContent = fileCache[filePath];
	if (fileContent && cache !== false) { return fileContent; }

	fileContent = fs.readFileSync(filePath, 'utf8');
	if (cache) { fileCache[filePath] = fileContent; }

	return fileContent;
};