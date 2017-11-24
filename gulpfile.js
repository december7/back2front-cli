/*!
 * Command line interface tools for Back2Front
 * 基于Gulp的构建流程
 */

'use strict';

var path = require('path');
var fs = require('fs');
var pump = require('pump');
var gulp = require('gulp');
var gulpFilter = require('gulp-filter');
var gulpMD5 = require('./lib/gulp-md5-export');
var gulpLEC = require('gulp-line-ending-corrector');
var gulpModify = require('gulp-modify');
var gulpCleanCSS = require('gulp-clean-css');
var gulpUglify = require('gulp-uglify');
var jsonFormat = require('json-format');
var babel = require('babel-core');
var util = require('./lib/util');
var depa = require('./depa');
var combiner = require('./lib/asset-combiner');
var minimist = require('minimist');
var argvs = require('minimist')(process.argv.slice(2));
var config = JSON.parse(argvs.config);


// 返回文件匹配规则
function srcGlobs(type, rule) {
	return path.resolve(config.build_from[type], rule);
}

// 返回目标目录
function gulpDest(type, subPath) {
	var destPath = config.build_to[type];
	if (subPath) {
		destPath = path.join(destPath, subPath);
	}
	return gulp.dest(destPath);
}

// 匹配纯文本文件的过滤器
function createPlainTextFilter() {
	return gulpFilter(function(file) {
		return [
			'html',
			'css',
			'js',
			'json',
			'txt',
			'md',
			'log',
			''
		].indexOf(
			path.extname(file.path).toLowerCase()
		) !== -1;
	}, {
		restore: true
	});
}

// 转换为资源引用路径（相对路径）
function toAssetPath(file) {
	return JSON.stringify(
		util.normalizeSlash(
			path.relative(file.base, file.path)
		)
	);
}

// 解析出可用的静态资源路径
//   使用第一、二个路径交替引用CSS、JS资源
//   使用第三个路径在CSS文件中引用资源
//   使用第三个路径在页面中引用资源
//   使用第三个路径作为JS加载器基路径
var urlPrefixes = (config.static_hosts || ['']).map(function(host) {
	var result = util.parseVars(config.static_url_prefix, {
		host: host,
		rev: config.rev
	});
	if (result[result.length - 1] !== '/') { result += '/'; }
	return result;
});
// 补够3个路径
while (urlPrefixes.length < 3) {
	urlPrefixes.push(urlPrefixes[urlPrefixes.length - 1]);
}


var depaMap; // 资源依赖表
var md5Map = { }; // 资源文件的MD5映射
var assetMap; // 合并文件后的资源依赖表


// 分析页面模板依赖
gulp.task('depa', function(callback) {
	depa(config.pjPath, null, config).then(function(result) {
		depaMap = result;
		callback();
	});
});


// 非代码文件加MD5戳
gulp.task('md5-others', function() {
	var plainTextFilter = createPlainTextFilter();
	return pump([
		gulp.src([
			srcGlobs('static', '**/*'),
			'!' + srcGlobs('static', '**/*.js'),
			'!' + srcGlobs('static', '**/*.css'),
			'!' + srcGlobs('static', '**/*.xtpl')
		]),
		plainTextFilter,
		gulpLEC(),
		plainTextFilter.restore,
		gulpMD5({
			exportMap: function(src, md5) {
				md5Map[src] = md5;
			}
		}),
		gulpDest('static')
	]);
});


// CSS构建
gulp.task('build-styles', ['md5-others'], function() {
	// 把CSS文件中的相对路径转换为绝对路径
	var inCSSURLPrefix = urlPrefixes[2];

	function cssRel2Root(file, fn) {
		return function(match, quot, origPath) {
			if (util.isURL(origPath) || util.isBase64(origPath)) {
				// 不对URL或Base64编码做处理
				return match;
			} else {
				// 计算出相对项目根目录的路径
				var relPath = util.normalizeSlash(
					path.relative(
						file.base,
						path.resolve(path.dirname(file.path), origPath)
					)
				);

				return fn(quot + inCSSURLPrefix + md5Map[relPath] + quot);
			}
		};
	}

	return pump([
		gulp.src(srcGlobs('static', '**/*.css')),
		gulpModify({
			// 相对路径转成绝对路径
            fileModifier: function(file, content) {
				return content
					// 移除CSS的import语句，因为分析依赖的时候已经把import的文件提取出来
					.replace(/^\s*@import\s+.*$/m, '')
					// 替换 url(...) 中的路径
					.replace(
						/\burl\((['"]?)(.+?)\1\)/g,
						cssRel2Root(file, function(result) {
							return 'url(' + result + ')';
						})
					);
			}
		}),
		gulpCleanCSS({
			compatibility: 'ie8',
			aggressiveMerging: false
		}),
		gulpModify({
            fileModifier: function(file, content) {
				var assetPath = toAssetPath(file);
				var result = 'cssFiles[' + assetPath + ']=' + JSON.stringify(content) + ';';
				file.path = util.convertExtname(file.path);
				return result;
			}
		}),
		gulpMD5({
			exportMap: function(src, md5) {
				md5Map[util.revertExtname(src)] = md5;
			}
		}),
		gulpDest('static')
	]);
});


// 构建模板（转成模块化js）
gulp.task('build-tpl', function() {
	return pump([
		gulp.src([
			srcGlobs('static', '**/*.xtpl'),
			'!' + srcGlobs('static', '**/*.page.xtpl'),
		]),
		gulpLEC(),
		gulpModify({
			fileModifier: function(file, content) {
				file.path = util.convertExtname(file.path);
				return 'define(' +
					JSON.stringify(
						util.normalizeSlash(
							path.relative(file.base, file.path)
						)
					) + ',' +
					'null,' +
					'function(r, e, m) {' +
						'm.exports=' + JSON.stringify(content) +
					'}' +
				');';
			}
		}),
		gulpMD5({
			exportMap: function(src, md5) {
				md5Map[util.revertExtname(src)] = md5;
			}
		}),
		gulpDest('static')
	]);
});


// 构建普通js和模块化js
gulp.task('build-js', function() {
	// 匹配普通JS
	var jsFilter = gulpFilter(function(file) {
		return /\.raw\.js$/i.test(file.path);
	}, {
		restore: true
	});
	// 匹配模块化JS
	var modjsFilter = gulpFilter(function(file) {
		return path.extname(file.path).toLowerCase() === '.js' &&
			!/\.raw\.js$/i.test(file.path);
	}, {
		restore: true
	});

	return pump([
		gulp.src(srcGlobs('static', '**/*.js')),
		jsFilter,
		gulpModify({
            fileModifier: function(file, content) {
				return 'jsFiles[' + toAssetPath(file) + ']=' +
					'function(window) {' + content + '};';
			}
		}),
		jsFilter.restore,
		modjsFilter,
		gulpModify({
            fileModifier: function(file, content) {
				return 'define(' +
					toAssetPath(file) + ',' +
					'null,' +
					'function(require, exports, module) { "use strict";' +
						babel.transform(content, {
							presets: [
								['env', { modules: false }],
								'stage-2'
							]
						}).code +
					'}' +
				');';
			}
		}),
		modjsFilter.restore,
		gulpUglify({ ie8: true }),
		gulpMD5({
			exportMap: function(src, md5) {
				md5Map[src] = md5;
			}
		}),
		gulpDest('static')
	]);
});


// 复制其余文件到目标目录
gulp.task('copy-others', function() {
	var plainTextFilter = createPlainTextFilter();
	return gulp
		.src([
			srcGlobs('server', '**/*'),
			'!' + srcGlobs('static', '**/*'), // 资源文件的复制放到copy-assets中完成
			'!' + srcGlobs('server', 'node_modules/**'),
			'!' + srcGlobs('server', '**/*.defined.js'),
			'!' + srcGlobs('server', '**/*.xtpl.js'),
			'!' + srcGlobs('server', '**/*.log')
		])
		.pipe(plainTextFilter)
		.pipe(gulpLEC())
		.pipe(plainTextFilter.restore)
		.pipe(gulpDest('server'));
});

// 复制资源文件到目标目录
// Express端只可能用到模板或者js
gulp.task('copy-assets', function() {
	return gulp
		.src([
			srcGlobs('static', '**/*.xtpl'),
			srcGlobs('static', '**/*.js')
		])
		.pipe(gulpLEC())
		.pipe(
			gulpDest('server', path.relative(
				config.build_from.server, config.build_from.static
			))
		);
});


// 资源合并，并输出合并后的资源依赖表
gulp.task('combine-assets', ['depa', 'build-styles', 'build-tpl', 'build-js'], function(callback) {
	assetMap = combiner.combine(
		depaMap,
		md5Map,
		config.combine,
		config.standalone,
		config.build_to.static
	);
	callback();
});


gulp.task('default', ['combine-assets', 'copy-others', 'copy-assets'], function() {
	// 服务器端用的MD5映射表
	fs.writeFileSync(
		path.join(config.build_to.server, 'md5-map.json'),
		jsonFormat(md5Map),
		'utf8'
	);

	// 浏览器端用的MD5映射表，要进行瘦身
	var md5MapForBrowser = { };
	
	let md5MapKeys = Object.keys(md5Map);
	// 先排序，避免由于顺序不同导致文件内容不一致
	md5MapKeys.sort();

	md5MapKeys.forEach(function(key) {
		// 模板文件、样式文件、模块化脚本文件不会动态载入，可以移除
		if (!/\.(xtpl|css|js)$/i.test(key) || /\.raw\.js$/.test(key)) {
			// 仅保留MD5的部分而不是完整的路径
			md5MapForBrowser[key] = md5Map[key].split('.').splice(-2, 1)[0];
		}
	});

	// 创建存放MD5映射表的文件夹
	var md5Dirname = path.join(config.build_to.static, 'md5-map');
	if (!fs.existsSync(md5Dirname)) {
		fs.mkdirSync(md5Dirname);
	}

	md5MapForBrowser = 'var md5Map = ' + JSON.stringify(md5MapForBrowser) + ';';
	var md5MapForBrowserFileName = 'md5-map.' + util.calcMd5(md5MapForBrowser, 10) + '.js';
	// 浏览器端用的MD5映射表
	fs.writeFileSync(
		path.join(md5Dirname, md5MapForBrowserFileName),
		md5MapForBrowser,
		'utf8'
	);

	Object.keys(assetMap).forEach(function(tplRelPath) {
		var tplAssets = assetMap[tplRelPath];
		['headjs', 'css', 'modjs', 'js'].forEach(function(assetType, i) {
			// 增加映射表资源引用
			if (assetType === 'headjs') {
				tplAssets[assetType] = tplAssets[assetType] || [];
				tplAssets[assetType].unshift('md5-map/' + md5MapForBrowserFileName);
			}

			if (!tplAssets[assetType]) { return; }

			tplAssets[assetType] = tplAssets[assetType].map(function(p) {
				if (!util.isURL(p)) {
					// 交替使用不同的URL前缀
					p = urlPrefixes[i % 2] + p;
				}
				return p;
			});
		});
	});

	// 保存最终的资源引用表
	fs.writeFileSync(
		path.join(config.build_to.server, 'asset-config.json'),
		jsonFormat({
			url_prefix: urlPrefixes[2],
			map: assetMap
		}),
		'utf8'
	);
});