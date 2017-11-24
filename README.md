# Back2Front CLI(Command line interface)

与[Back2Front框架](https://github.com/heeroluo/back2front)配套的构建工具。


## 安装

```
npm install back2front-cli -g
```


## 使用

### 依赖分析

```
back2front depa <path> [--o <output-file>]
```

其中「path」为项目路径。默认情况下，依赖分析结果会输出到命令行界面，如果要保存为文件，请使用「--o」参数指定文件路径。

### 项目构建

构建前要在**项目根目录**下放置构建配置文件「**build-config.json**」，具体配置项见[构建配置](https://github.com/heeroluo/back2front-cli/wiki/%E6%9E%84%E5%BB%BA%E9%85%8D%E7%BD%AE)。

```
back2front build <path> --env <env>
```

其中，「path」为项目路径；「env」为环境参数，可以为「dev」、「test」（测试环境）、「pre」（预发布环境）或「prod」（生产环境）。