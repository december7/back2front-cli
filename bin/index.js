#!/usr/bin/env node

/*!
 * Command line tools for Back2Front
 * 命令入口
 */

'use strict';

var path = require('path'),
	fs = require('fs'),
	argvs = require('minimist')(process.argv.slice(2)),
	jsonFormat = require('json-format'),
	errorExit = require('../lib/util').errorExit;


// 带参数v时，仅打印版本号
if (argvs.v === true) {
	console.log(require('../package').version);
	process.exit(0);
}


var fn;
switch (argvs._[0]) {
	// 构建
	case 'build':
		fn = require('../build');
		break;
	
	// 依赖分析
	case 'depa':
		fn = require('../depa');
		break;

	default:
		errorExit('Please use "back2front build" or "back2front depa"');
}


// 检查项目路径是否存在
var pjPath = argvs._[1];
if (pjPath) {
	pjPath = path.resolve(pjPath);
	if ( !fs.existsSync(pjPath) ) {
		errorExit('"' + pjPath + '" does not exist');
	}
} else {
	errorExit('Please specify project path');
}

// 检查构建配置文件是否存在
var configPath = path.join(pjPath, 'build-config.json');
if ( !fs.existsSync(configPath) ) {
	errorExit('Configuration file not found.');
}


var result = fn(pjPath, argvs, require(configPath));

// 输出依赖分析结果
if (argvs._[0] === 'depa') {
	result.then(function(map) {
		// 带o参数时，则输出到指定路径，否则直接打印
		if (argvs.o) {
			fs.writeFileSync(
				path.resolve(argvs.o),
				jsonFormat(map),
				'utf-8'
			);
		} else {
			console.dir(map);
		}
	});
}