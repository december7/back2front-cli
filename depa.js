/*!
 * Command line tools for Back2Front
 * 依赖分析
 */

'use strict';

var fs = require('fs'),
	path = require('path'),
	minimatch = require('minimatch'),
	glob = require('glob'),
	util = require('./lib/util');


module.exports = function(pjPath, options, config) {
	// 静态资源根路径
	var basePath = path.resolve(pjPath, config.static_path || config.build_from.static);

	// 获取资源相对于资源根目录的路径
	function getRelPath(assetPath, contextPath, assetType) {
		assetPath = assetPath.replace(/\?.*$/, '');
		// 如果以点开头，则相对上下文目录，否则相对资源根路径
		assetPath = /^\./.test(assetPath)
			? path.resolve(path.dirname(contextPath), assetPath)
			: path.join(basePath, assetPath);

		if ( !path.extname(assetPath) ) {
			assetPath += '.';
			switch (assetType) {
				case 'headjs':
				case 'js':
					assetPath += 'raw.js';
					break;
		
				case 'modjs':
					assetPath += 'js';
					break;

				default:
					assetPath += assetType;
			}
		}

		return util.normalizeSlash(
			path.relative(basePath, assetPath)
		);
	}

	// 解析资源路径
	function parsePath(p) {
		// mod@ver to mod/ver/mod
		return p.replace(
			/([^\\\/]+)@([^\\\/]+)/g,
			function(match, module, version) {
				return module + '/' + version + '/' + module;
			}
		);
	}

	// 合并两个对象中的同名数组
	function concatObj(target, src) {
		for (var key in src) {
			target[key] = target[key].concat(src[key]);
		}
	}

	// 数组去重复，主要用于去除重复的资源依赖
	function uniqueArray(arr) {
		var flags = { };
		return arr.filter(function(item) {
			if (!item || flags[item]) {
				return false;
			} else {
				flags[item] = true;
				return true;
			}
		});
	}


	// 资源依赖分析器
	var assetParsers = {
		// 不在JS里面依赖其他JS，故无需分析
		_headjs: {
			parse: function() { return [ ]; }
		},

		// 只分析单个CSS的直接依赖，并进行缓存
		_css: {
			_cache: { },
			parse: function(filePath, fileContent) {
				var result = this._cache[filePath];
				if (!result) {
					// 粗略移除代码中的注释
					fileContent = fileContent.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/mg, '');

					result = [ ];
					// 只匹配 import url(...)
					var re = /@import\s+url\(["']*(.+?)["']*\)/, match;
					while ( match = re.exec(fileContent) ) {
						result.push( match[1].trim() );
					}
					this._cache[filePath] = result;
				}

				return result.slice();
			}
		},

		// 不在JS里面依赖其他JS，故无需分析
		_js: {
			parse: function() { return [ ]; }
		},

		// 只分析单个模块化JS的直接依赖，并进行缓存
		_modjs: {
			_cache: { },
			parse: function(filePath, fileContent) {
				var result = this._cache[filePath];

				if (!result) {
					// 粗略移除代码中的注释
					fileContent = fileContent
						.replace(/^\s*\/\*[\s\S]*?\*\/\s*$/mg, '')
						.replace(/^\s*\/\/.*$/mg, '');

					result = [ ];
					var re = /(?:^|[^.$])\brequire\s*\(\s*(["'])([^"'\s\)]+)\1\s*\)/g, match;
					while ( match = re.exec(fileContent) ) {
						result.push( parsePath(match[2]) );
					}

					this._cache[filePath] = result;
				}

				return result.slice();
			}
		},

		_cache: { },

		parse: function(fileRelPath, type) {
			var t = this,
				filePath = path.join(basePath, fileRelPath),
				cache = this._cache;

			if (cache[filePath]) { return cache[filePath].slice(); }

			var fileContent = util.readFile(filePath),
				parser = t['_' + type], 
				deps = parser.parse(filePath, fileContent),
				result = [ ];

			// 循环每一个依赖，递归获取依赖的依赖
			deps.forEach(function(dep) {
				// 当前版本不处理外链资源
				if ( util.isURL(dep) ) { return; }

				dep = getRelPath(dep, filePath, type);
				// 自身
				result.push(dep);
				// 依赖
				result = result.concat( t.parse(dep, type) );
			});

			// 去重复
			result = uniqueArray(result);

			cache[filePath] = result;

			return result.slice();
		}
	};


	// 分析模板依赖的资源
	var tplParser = {
		_cache: { },

		parse: function(fileRelPath) {
			var cache = this._cache;
			if (cache[fileRelPath]) { return cache[fileRelPath]; }

			var filePath = path.join(basePath, fileRelPath),
				fileContent = util.readFile(filePath),
				result = {
					tpl: [ ],
					headjs: [ ],
					css: [ ],
					js: [ ],
					modjs: [ ]
				},
				match,
				subMatch;

			var re_assetList = /\{{2,3}#?\s*(headjs|css|js|modjs)\s*\(([\W\w]*?)\)/g,
				re_assetItem,
				assetType,
				assetPath;

			// 分析静态资源依赖
			while ( match = re_assetList.exec(fileContent) ) {
				assetType = match[1];
				re_assetItem = /(["'])(.+?)\1/g;
				while ( subMatch = re_assetItem.exec(match[2]) ) {
					assetPath = subMatch[2];
					// 当前版本不处理外链资源
					if ( util.isURL(assetPath) ) { continue; }

					assetPath = getRelPath(parsePath(assetPath), filePath, assetType);

					// 自身
					result[assetType].push(assetPath);
					// 依赖
					result[assetType] = result[assetType].concat(
						assetParsers.parse(assetPath, assetType)
					);
				}
			}

			// 分析模板依赖
			var re_depTpl = /\{{2,3}\s*(?:extend|parse|include|includeOnce)\s*\(\s*(['"])(.+?)\1/g,
				depTpl,
				depResult,
				isCSR;

			while ( match = re_depTpl.exec(fileContent) ) {
				isCSR = false;
				depTpl = match[2].replace(/\?(.*)$/, function(match, param) {
					isCSR = /^csr(?:Only)?$/.test(param);
					return '';
				});
				depTpl = getRelPath(depTpl, filePath, 'xtpl');

				// 递归调用获取所有依赖
				depResult = this.parse(depTpl);
				// 自身
				result.tpl.push(depTpl);
				// 依赖
				concatObj(result, depResult);

				// 需要在浏览器端渲染的模板
				if (isCSR) {
					depResult.tpl.forEach(function(tpl) {
						result.modjs.push(tpl + '.js');
					});
					result.modjs.push(depTpl + '.js');
				}
			}

			for (var i in result) {
				result[i] = uniqueArray(result[i]);
			}

			cache[fileRelPath] = result;

			return result;
		}
	};


	return new Promise(function(resolve, reject) {
		glob('**/*.page.xtpl', {
			cwd: basePath
		}, function(err, files) {
			if (err) {
				reject(err);
			} else {
				var allResult = { };
				files.forEach(function(fileRelPath) {
					allResult[fileRelPath] = tplParser.parse(fileRelPath);
				});
				resolve(allResult);
			}
		});
	});
};