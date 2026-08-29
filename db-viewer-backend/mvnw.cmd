@REM Maven Wrapper startup script - Windows
@echo off
setlocal

SET MAVEN_WRAPPER_JAR=.mvn\wrapper\maven-wrapper.jar

IF EXIST %MAVEN_WRAPPER_JAR% (
    java -jar %MAVEN_WRAPPER_JAR% %*
) ELSE (
    WHERE mvn >nul 2>&1
    IF %ERRORLEVEL% == 0 (
        mvn %*
    ) ELSE (
        echo ERROR: No Maven wrapper jar or 'mvn' found on PATH.
        echo Install Maven or run: mvn -N wrapper:wrapper
        exit /b 1
    )
)
