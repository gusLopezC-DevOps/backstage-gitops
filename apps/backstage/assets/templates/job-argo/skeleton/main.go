package main

import (
	"fmt"
	"time"
)

func main() {
	fmt.Printf("job %s ejecutado a las %s\n", "${{ values.repoName }}", time.Now().Format(time.RFC3339))
}