plugins {
    java
    id("org.springframework.boot") version "3.2.5"
}

group = "com.example"
version = "1.4.2"

repositories {
    mavenCentral()
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("com.example:widget-common:0.9.1")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
}

tasks.test {
    useJUnitPlatform()
}
